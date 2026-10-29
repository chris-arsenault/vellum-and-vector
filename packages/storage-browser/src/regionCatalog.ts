import type { Database } from "@sqlite.org/sqlite-wasm";
import type { Geometry, LineString } from "geojson";
import {
  minimumRegionWidthMetres,
  polygonParts,
  rectangle,
  regionBoundaryLines,
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
import type { GeometryKernel } from "./geometryKernel";

interface Context {
  parent: Geometry;
  parentArea: number;
  precision: number;
  revision: number;
}
function point({ x, y }: Position): Geometry {
  return { type: "Point", coordinates: [x, y] };
}
function extent(geometry: Geometry): Bounds {
  if (geometry.type === "Point") {
    const [x, y] = geometry.coordinates;
    return [x, y, x, y];
  }
  const coordinates = regionBoundaryLines(geometry).flatMap((l) => l.coordinates);
  const xs = coordinates.map((c) => c[0]),
    ys = coordinates.map((c) => c[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
/**
 * Regions are indexed polygons: the ones generation publishes and the ones creators keep. A
 * click reads the polygons covering it; a drawn line splits the polygons it crosses.
 */
export class RegionCatalog {
  constructor(
    private db: Database,
    private kernel: GeometryKernel,
    private readFeatures: (query: FeatureQuery) => Promise<FeaturePage>
  ) {}
  private context(query: RegionQuery): Context {
    const { worldId, spaceId } = query.scope;
    const world = this.db.selectObject("SELECT data,revision FROM worlds WHERE id=?", [worldId]);
    requireThat(world, "missing_world", "Choose an existing world.");
    const precision = JSON.parse(String(world.data)).reference.precision ?? 1e-6;
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
    const record = decodeRecord(parentRow, this.kernel);
    const parent =
      record.data.kind === "view"
        ? record.data.value.region?.footprint
        : record.data.kind === "area"
          ? record.data.value.footprint
          : null;
    requireThat(parent, "missing_region", "Choose a geographic parent.");
    return {
      parent,
      parentArea: this.kernel.measure(parent, precision).area,
      precision,
      revision: Number(world.revision),
    };
  }
  /** The parent's other children whose indexed bounds meet `bounds`. */
  private siblings(query: RegionQuery, bounds: Bounds) {
    const rows = this.db.selectObjects(
      `SELECT r.* FROM records r JOIN record_bounds b USING(record_id)
      WHERE r.world_id=? AND r.space_id=? AND r.area_id=? AND r.kind='view'
      AND json_type(r.data,'$.value.region')='object'
      AND json_extract(r.data,'$.value.region.parentId') IS ? AND r.id IS NOT ?
      AND b.min_x<=? AND b.max_x>=? AND b.min_y<=? AND b.max_y>=? ORDER BY r.id`,
      [
        query.scope.worldId,
        query.scope.spaceId,
        query.sourceAreaId,
        query.parentId,
        query.editingId,
        bounds[2],
        bounds[0],
        bounds[3],
        bounds[1],
      ]
    );
    return rows.flatMap((row) => {
      const record = decodeRecord(row, this.kernel);
      return record.data.kind === "view" && record.data.value.region
        ? [{ id: record.reference.id, footprint: record.data.value.region.footprint }]
        : [];
    });
  }
  /** Indexed polygons meeting a point or line. */
  private async polygons(
    query: RegionQuery,
    geometry: Geometry,
    predicate: "covers" | "intersects"
  ) {
    const found: RegionCandidate[] = [];
    let after: string | null = null;
    do {
      const page: FeaturePage = await this.readFeatures({
        scope: query.scope,
        extent: extent(geometry),
        layers: [],
        after,
        limit: 64,
        predicate,
        geometry,
        dimension: "polygon",
      });
      for (const { feature } of page.records) {
        const footprint = feature.geometry;
        if (footprint.type.includes("Polygon")) found.push({ name: feature.name, footprint });
      }
      after = page.next;
    } while (after);
    return found;
  }
  /** A polygon inside the parent and outside its committed siblings. */
  private available(query: RegionQuery, context: Context, shape: Geometry) {
    const { kernel } = this,
      { precision } = context;
    let clipped = kernel.overlay(shape, context.parent, precision, "intersection");
    if (!clipped) return null;
    for (const sibling of this.siblings(query, kernel.encode(clipped, precision).bounds)) {
      clipped = kernel.overlay(clipped, sibling.footprint, precision, "difference");
      if (!clipped) return null;
    }
    return clipped;
  }
  /** The pieces a shape's own boundary and the cuts enclose. */
  private split(shape: Geometry, cuts: Geometry[], precision: number) {
    if (!cuts.length) return [shape];
    const lines: Geometry = {
      type: "MultiLineString",
      coordinates: [shape, ...cuts].flatMap(regionBoundaryLines).map((l) => l.coordinates),
    };
    const noded = this.kernel.nodeLines(lines, shape, precision);
    if (!noded) return [shape];
    return polygonParts(this.kernel.polygonize(noded, precision)).flatMap(
      (face) => this.kernel.overlay(face, shape, precision, "intersection") ?? []
    );
  }
  private candidates(query: RegionQuery, context: Context, sources: RegionCandidate[]) {
    const { kernel } = this,
      { precision, parentArea } = context;
    const unique = new Map<string, { candidate: RegionCandidate; area: number }>();
    for (const source of sources) {
      const available = this.available(query, context, source.footprint);
      if (!available) continue;
      for (const piece of this.split(available, query.cuts, precision))
        for (const shape of polygonParts(piece)) {
          const { area, length } = kernel.measure(shape, precision);
          if (area >= parentArea || (2 * area) / length < minimumRegionWidthMetres) continue;
          if (query.position && !kernel.relation(shape, point(query.position), precision, "covers"))
            continue;
          const key = JSON.stringify(kernel.canonical(shape, precision));
          if (!unique.has(key))
            unique.set(key, { candidate: { name: source.name, footprint: shape }, area });
        }
    }
    const target =
      ((query.viewport[2] - query.viewport[0]) * (query.viewport[3] - query.viewport[1])) / 3;
    return [...unique.values()]
      .sort((a, b) => Math.abs(Math.log(a.area / target)) - Math.abs(Math.log(b.area / target)))
      .map(({ candidate }) => candidate);
  }
  /** Cuts divide the indexed polygons they cross. */
  private async cutSources(query: RegionQuery) {
    const sources: RegionCandidate[] = [];
    for (const cut of query.cuts) sources.push(...(await this.polygons(query, cut, "intersects")));
    return sources;
  }
  async choices(query: RegionQuery): Promise<RegionChoices> {
    const context = this.context(query),
      position = query.position;
    requireThat(position, "region_position", "Choose a location.");
    if (!query.cuts.length) {
      const childId =
        this.siblings(query, [position.x, position.y, position.x, position.y]).find((sibling) =>
          this.kernel.relation(sibling.footprint, point(position), context.precision, "covers")
        )?.id ?? null;
      if (childId) return { revision: context.revision, childId, candidates: [] };
    }
    const sources = query.cuts.length
      ? await this.cutSources(query)
      : await this.polygons(query, point(position), "covers");
    return {
      revision: context.revision,
      childId: null,
      candidates: this.candidates(query, context, sources),
    };
  }
  async draw(input: RegionDrawing): Promise<RegionDrawingResult> {
    const context = this.context(input.query);
    const geometry = input.geometry;
    const lines: LineString[] = geometry.type.includes("LineString")
      ? regionBoundaryLines(geometry)
      : [];
    if (!lines.length) {
      const clipped = this.available(input.query, context, geometry);
      requireThat(
        clipped,
        "region_outline",
        "Choose an outline inside the available parent region."
      );
      const { area, length } = this.kernel.measure(clipped, context.precision);
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
    const snapped: Geometry[] = [];
    for (const line of lines)
      snapped.push(await this.snap(input.query, context, line, input.tolerance));
    const query = { ...input.query, cuts: [...input.query.cuts, ...snapped], position: null };
    const choices = this.candidates(query, context, await this.cutSources(query));
    return {
      revision: context.revision,
      cuts: query.cuts,
      candidate: choices[0] ?? null,
      candidates: choices,
    };
  }
  /** Line ends snap to the parent, nearby siblings, earlier cuts and nearby indexed polygons. */
  private async snap(query: RegionQuery, context: Context, line: LineString, tolerance: number) {
    const boundaries: Geometry[] = [context.parent, ...query.cuts];
    for (const [x, y] of [line.coordinates[0], line.coordinates.at(-1)!]) {
      const window: Bounds = [x - tolerance, y - tolerance, x + tolerance, y + tolerance];
      boundaries.push(...this.siblings(query, window).map((s) => s.footprint));
      for (const polygon of await this.polygons(query, rectangle(window), "intersects"))
        boundaries.push(polygon.footprint);
    }
    return snapRegionCut(line, boundaries, tolerance);
  }
}
