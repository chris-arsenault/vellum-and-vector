import type { Database } from "@sqlite.org/sqlite-wasm";
import type { Geometry, LineString } from "geojson";
import {
  minimumRegionWidthMetres,
  polygonParts,
  requireThat,
  snapRegionCut,
  type FeaturePage,
  type FeatureQuery,
  type RegionCandidate,
  type RegionChoices,
  type RegionDrawing,
  type RegionDrawingResult,
  type RegionQuery,
} from "@atlas/domain";
import { decodeRecord } from "./catalogRecords";
import { segmentLine } from "./boundarySegments";
import { BoundaryTiles } from "./boundaryTiles";
import { RegionFaces } from "./regionFaces";
import { cutProbes } from "./cutProbes";

interface Context {
  available: Geometry;
  parent: Geometry;
  precision: number;
  revision: number;
  childId: string | null;
  periodicBounds: import("@atlas/domain").Bounds | null;
}
/** A region operation owns overlays and reads beside the indexed catalog. */
export class RegionCatalog {
  private faces: RegionFaces;
  constructor(
    private db: Database,
    private tiles: BoundaryTiles,
    private readFeatures: (query: FeatureQuery) => Promise<FeaturePage>
  ) {
    this.faces = new RegionFaces(tiles);
  }
  private context(query: RegionQuery): Context {
    const { worldId, spaceId } = query.scope;
    const world = this.db.selectObject("SELECT data,revision FROM worlds WHERE id=?", [worldId]);
    requireThat(world, "missing_world", "Choose an existing world.");
    const reference = JSON.parse(String(world.data)).reference;
    const precision = reference.precision ?? 1e-6;
    const parentRow = query.parentId
      ? this.db.selectObject("SELECT * FROM records WHERE world_id=? AND kind='view' AND id=?", [
          worldId,
          query.parentId,
        ])
      : this.db.selectObject("SELECT * FROM records WHERE world_id=? AND kind='area' AND id=?", [
          worldId,
          query.sourceAreaId,
        ]);
    requireThat(parentRow, "missing_region", "Choose an existing parent region.");
    requireThat(
      String(parentRow.space_id) === spaceId,
      "region_space",
      "Keep a region in its located space."
    );
    const record = decodeRecord(parentRow, this.tiles.kernel);
    const parent =
      record.data.kind === "view"
        ? record.data.value.region?.footprint
        : record.data.kind === "area"
          ? record.data.value.footprint
          : null;
    requireThat(parent, "missing_region", "Choose a geographic parent.");
    const { available, childId } = this.excludeSiblings(query, parent, precision);
    requireThat(
      available || childId,
      "region_subdivided",
      "This parent is fully subdivided. Open one of its regions."
    );
    return {
      available: available ?? parent,
      parent,
      precision,
      childId,
      revision: Number(world.revision),
      periodicBounds:
        reference.boundaryMode === "cylinder"
          ? this.tiles.kernel.encode(reference.domain, precision).bounds
          : null,
    };
  }
  private excludeSiblings(query: RegionQuery, parent: Geometry, precision: number) {
    let available: Geometry | null = parent,
      childId: string | null = null;
    const rows = this.db.selectObjects(
      `SELECT * FROM records WHERE world_id=? AND space_id=? AND area_id=? AND kind='view'
      AND json_type(data,'$.value.region')='object'
      AND json_extract(data,'$.value.region.parentId') IS ? AND id IS NOT ? ORDER BY id`,
      [
        query.scope.worldId,
        query.scope.spaceId,
        query.sourceAreaId,
        query.parentId,
        query.editingId,
      ]
    );
    for (const row of rows) {
      const record = decodeRecord(row, this.tiles.kernel);
      if (record.data.kind !== "view" || !record.data.value.region) continue;
      const geometry = record.data.value.region.footprint;
      if (
        query.position &&
        !query.cuts.length &&
        this.tiles.kernel.relation(
          geometry,
          { type: "Point", coordinates: [query.position.x, query.position.y] },
          precision,
          "covers"
        )
      )
        childId = record.reference.id;
      if (available)
        available = this.tiles.kernel.overlay(available, geometry, precision, "difference");
    }
    return { available, childId };
  }
  async choices(query: RegionQuery): Promise<RegionChoices> {
    const context = this.context(query);
    if (context.childId)
      return { revision: context.revision, childId: context.childId, candidates: [] };
    const candidates = await this.candidates(query, context);
    return { revision: context.revision, childId: null, candidates };
  }
  private async candidates(query: RegionQuery, context: Context) {
    const { available, precision, parent } = context;
    const kernel = this.tiles.kernel;
    const parentArea = kernel.measure(parent, precision).area;
    const unique = new Map<string, { candidate: RegionCandidate; area: number }>();
    const add = (name: string, geometry: Geometry | null) => {
      if (!geometry) return;
      const clipped = kernel.overlay(geometry, available, precision, "intersection");
      if (!clipped) return;
      for (const shape of polygonParts(clipped)) {
        const { area, length } = kernel.measure(shape, precision);
        if (area >= parentArea || (2 * area) / length < minimumRegionWidthMetres) continue;
        if (
          query.position &&
          !kernel.relation(
            shape,
            { type: "Point", coordinates: [query.position.x, query.position.y] },
            precision,
            "covers"
          )
        )
          continue;
        const key = JSON.stringify(kernel.canonical(shape, precision));
        if (!unique.has(key)) unique.set(key, { candidate: { name, footprint: shape }, area });
      }
    };
    if (query.position && !query.cuts.length) await this.covering(query, add);
    for (const position of this.probes(query, context)) {
      add(
        "Region",
        this.faces.at(
          query.scope,
          available,
          query.cuts,
          position,
          precision,
          context.periodicBounds
        )
      );
    }
    const target =
      ((query.viewport[2] - query.viewport[0]) * (query.viewport[3] - query.viewport[1])) / 3;
    return [...unique.values()]
      .sort((a, b) => Math.abs(Math.log(a.area / target)) - Math.abs(Math.log(b.area / target)))
      .map(({ candidate }) => candidate);
  }
  private async covering(query: RegionQuery, add: (name: string, geometry: Geometry) => void) {
    const { x, y } = query.position!;
    let after: string | null = null;
    do {
      const page = await this.readFeatures({
        scope: query.scope,
        extent: [x, y, x, y],
        layers: [],
        after,
        limit: 64,
        predicate: "covers",
        geometry: { type: "Point", coordinates: [x, y] },
      });
      for (const { feature } of page.records) {
        const geometry = feature.footprint ?? feature.geometry;
        if (geometry.type.includes("Polygon")) add(feature.name, geometry);
      }
      after = page.next;
    } while (after);
  }
  private *probes(query: RegionQuery, context: Context) {
    if (query.position) {
      yield query.position;
      return;
    }
    const graph = this.tiles.graph(
      query.scope,
      [context.available, ...query.cuts],
      context.precision
    );
    yield* cutProbes(graph, query.cuts, this.tiles.size, context.precision);
  }
  async draw(input: RegionDrawing): Promise<RegionDrawingResult> {
    const context = this.context(input.query);
    const geometry = input.geometry;
    const lines: LineString[] =
      geometry.type === "LineString"
        ? [geometry]
        : geometry.type === "MultiLineString"
          ? geometry.coordinates.map((coordinates) => ({ type: "LineString", coordinates }))
          : [];
    if (!lines.length) {
      const clipped = this.tiles.kernel.overlay(
        context.available,
        geometry,
        context.precision,
        "intersection"
      );
      requireThat(
        clipped,
        "region_outline",
        "Choose an outline inside the available parent region."
      );
      const { area, length } = this.tiles.kernel.measure(clipped, context.precision);
      requireThat(
        (2 * area) / length >= minimumRegionWidthMetres,
        "region_size",
        "Choose a larger outline inside the available parent region."
      );
      return {
        revision: context.revision,
        cuts: input.query.cuts,
        candidate: { name: "Region", footprint: clipped },
        candidates: [],
      };
    }
    const cuts = [
      ...input.query.cuts,
      ...lines.map((line) => this.snap(input.query, context, line, input.tolerance)),
    ];
    const choices = await this.candidates({ ...input.query, cuts, position: null }, context);
    return { revision: context.revision, cuts, candidate: choices[0] ?? null, candidates: choices };
  }
  private snap(query: RegionQuery, context: Context, line: LineString, tolerance: number) {
    const nearby = [line.coordinates[0], line.coordinates.at(-1)!].flatMap(([x, y]) =>
      this.tiles.index.segments(query.scope, [
        x - tolerance,
        y - tolerance,
        x + tolerance,
        y + tolerance,
      ])
    );
    const boundaries: Geometry[] = [
      context.available,
      ...query.cuts,
      { type: "MultiLineString", coordinates: nearby.map(segmentLine) },
    ];
    return snapRegionCut(line, boundaries, tolerance);
  }
}
