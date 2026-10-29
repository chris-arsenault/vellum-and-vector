import type { Database } from "@sqlite.org/sqlite-wasm";
import type { Geometry, LineString } from "geojson";
import {
  minimumRegionWidthMetres,
  polygonParts,
  requireThat,
  snapRegionCut,
  type Bounds,
  type FeaturePage,
  type FeatureQuery,
  type Position,
  type RegionCandidate,
  type RegionChoices,
  type RegionDrawing,
  type RegionDrawingResult,
  type RegionQuery,
} from "@atlas/domain";
import { decodeRecord } from "./catalogRecords";
import { boundarySegments, segmentBounds, segmentLine } from "./boundarySegments";
import { BoundaryTiles } from "./boundaryTiles";
import { RegionFaces, type RegionMask } from "./regionFaces";
import { cutProbes } from "./cutProbes";

interface Context {
  parent: Geometry;
  parentArea: number;
  parentLength: number;
  precision: number;
  revision: number;
  periodicBounds: Bounds | null;
}
interface Sibling {
  id: string;
  footprint: Geometry;
}
function point({ x, y }: Position): Geometry {
  return { type: "Point", coordinates: [x, y] };
}
/**
 * A region operation owns overlays and reads beside the indexed catalog. Sibling regions are
 * read through their indexed bounds, so a pick touches only the siblings near its face.
 */
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
    const { area, length } = this.tiles.kernel.measure(parent, precision);
    return {
      parent,
      parentArea: area,
      parentLength: length,
      precision,
      revision: Number(world.revision),
      periodicBounds:
        reference.boundaryMode === "cylinder"
          ? this.tiles.kernel.encode(reference.domain, precision).bounds
          : null,
    };
  }
  /** The parent's other children, all of them or those whose bounds meet `bounds`. */
  private siblings(query: RegionQuery, bounds: Bounds | null): Sibling[] {
    const rows = this.db.selectObjects(
      `SELECT r.* FROM records r JOIN record_bounds b USING(record_id)
      WHERE r.world_id=? AND r.space_id=? AND r.area_id=? AND r.kind='view'
      AND json_type(r.data,'$.value.region')='object'
      AND json_extract(r.data,'$.value.region.parentId') IS ? AND r.id IS NOT ?
      AND (? OR (b.min_x<=? AND b.max_x>=? AND b.min_y<=? AND b.max_y>=?)) ORDER BY r.id`,
      [
        query.scope.worldId,
        query.scope.spaceId,
        query.sourceAreaId,
        query.parentId,
        query.editingId,
        bounds ? 0 : 1,
        bounds?.[2] ?? 0,
        bounds?.[0] ?? 0,
        bounds?.[3] ?? 0,
        bounds?.[1] ?? 0,
      ]
    );
    return rows.flatMap((row) => {
      const record = decodeRecord(row, this.tiles.kernel);
      return record.data.kind === "view" && record.data.value.region
        ? [{ id: record.reference.id, footprint: record.data.value.region.footprint }]
        : [];
    });
  }
  private childAt(query: RegionQuery, context: Context, position: Position) {
    const { x, y } = position;
    return (
      this.siblings(query, [x, y, x, y]).find((sibling) =>
        this.tiles.kernel.relation(sibling.footprint, point(position), context.precision, "covers")
      )?.id ?? null
    );
  }
  /**
   * The available part of the parent, as a mask. Siblings are closed shapes, so a face is
   * clipped by those near it instead of walking their linework; siblings a cut meets stay in
   * the walk, where the cut's snapped ends node against their edges.
   */
  private mask(query: RegionQuery, context: Context): RegionMask {
    const { kernel } = this.tiles,
      { parent, precision } = context;
    const touched = new Map<string, Geometry>();
    for (const cut of query.cuts)
      for (const segment of boundarySegments(cut))
        for (const sibling of this.siblings(query, segmentBounds(segment)))
          touched.set(sibling.id, sibling.footprint);
    return {
      boundary: [parent, ...touched.values()],
      covers: (position) =>
        kernel.relation(parent, point(position), precision, "covers") &&
        !this.childAt(query, context, position),
      clip: (shape) => {
        let clipped = kernel.overlay(shape, parent, precision, "intersection");
        if (!clipped) return null;
        for (const sibling of this.siblings(query, kernel.encode(clipped, precision).bounds)) {
          clipped = kernel.overlay(clipped, sibling.footprint, precision, "difference");
          if (!clipped) return null;
        }
        return clipped;
      },
    };
  }
  async choices(query: RegionQuery): Promise<RegionChoices> {
    const context = this.context(query);
    const childId =
      query.position && !query.cuts.length ? this.childAt(query, context, query.position) : null;
    if (childId) return { revision: context.revision, childId, candidates: [] };
    const candidates = await this.candidates(query, context, this.mask(query, context));
    return { revision: context.revision, childId: null, candidates };
  }
  private async candidates(query: RegionQuery, context: Context, mask: RegionMask) {
    const { precision, parentArea } = context;
    const kernel = this.tiles.kernel;
    const unique = new Map<string, { candidate: RegionCandidate; area: number }>();
    const add = (name: string, geometry: Geometry | null) => {
      if (!geometry) return;
      const clipped = mask.clip(geometry);
      if (!clipped) return;
      for (const shape of polygonParts(clipped)) {
        const { area, length } = kernel.measure(shape, precision);
        if (area >= parentArea || (2 * area) / length < minimumRegionWidthMetres) continue;
        if (query.position && !kernel.relation(shape, point(query.position), precision, "covers"))
          continue;
        const key = JSON.stringify(kernel.canonical(shape, precision));
        if (!unique.has(key)) unique.set(key, { candidate: { name, footprint: shape }, area });
      }
    };
    if (query.position && !query.cuts.length) await this.covering(query, add);
    for (const position of this.probes(query, context, mask)) {
      add(
        "Region",
        this.faces.at(query.scope, mask, query.cuts, position, precision, context.periodicBounds)
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
  private *probes(query: RegionQuery, context: Context, mask: RegionMask) {
    if (query.position) {
      yield query.position;
      return;
    }
    const graph = this.tiles.graph(
      query.scope,
      [...mask.boundary, ...query.cuts],
      context.precision
    );
    yield* cutProbes(graph, query.cuts, this.tiles.size, context.precision);
  }
  /** Siblings fill the parent when their areas leave less than a precision strip of it. */
  private requireRoom(query: RegionQuery, context: Context) {
    const { kernel } = this.tiles,
      { precision } = context;
    const taken = this.siblings(query, null).reduce(
      (sum, sibling) => sum + kernel.measure(sibling.footprint, precision).area,
      0
    );
    requireThat(
      context.parentArea - taken > precision * context.parentLength,
      "region_subdivided",
      "This parent is fully subdivided. Open one of its regions."
    );
  }
  async draw(input: RegionDrawing): Promise<RegionDrawingResult> {
    const context = this.context(input.query);
    this.requireRoom(input.query, context);
    const geometry = input.geometry;
    const lines: LineString[] =
      geometry.type === "LineString"
        ? [geometry]
        : geometry.type === "MultiLineString"
          ? geometry.coordinates.map((coordinates) => ({ type: "LineString", coordinates }))
          : [];
    if (!lines.length) {
      const clipped = this.mask(input.query, context).clip(geometry);
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
    const query = { ...input.query, cuts, position: null };
    const choices = await this.candidates(query, context, this.mask(query, context));
    return { revision: context.revision, cuts, candidate: choices[0] ?? null, candidates: choices };
  }
  private snap(query: RegionQuery, context: Context, line: LineString, tolerance: number) {
    const windows = [line.coordinates[0], line.coordinates.at(-1)!].map(([x, y]): Bounds => [
      x - tolerance,
      y - tolerance,
      x + tolerance,
      y + tolerance,
    ]);
    const nearby = windows.flatMap((window) => this.tiles.segments(query.scope, window));
    const siblings = new Map(
      windows.flatMap((window) => this.siblings(query, window)).map((s) => [s.id, s.footprint])
    );
    const boundaries: Geometry[] = [
      context.parent,
      ...siblings.values(),
      ...query.cuts,
      { type: "MultiLineString", coordinates: nearby.map(segmentLine) },
    ];
    return snapRegionCut(line, boundaries, tolerance);
  }
}
