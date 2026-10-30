import type { Database } from "@sqlite.org/sqlite-wasm";
import type { Geometry, LineString } from "geojson";
import {
  minimumRegionWidthMetres,
  polygonParts,
  connectedRegionParts,
  canonicalGeometry,
  polygonGeometry,
  regionalDistricts,
  regionalSelectionArea,
  rectangle,
  regionBoundaryLines,
  requireThat,
  snapRegionCut,
  spatial,
  type Bounds,
  type FeaturePage,
  type FeatureQuery,
  type Position,
  type RegionCandidate,
  type RegionChoices,
  type RegionDrawing,
  type RegionDrawingResult,
  type RegionQuery,
  type World,
} from "@atlas/domain";
import { decodeRecord } from "./catalogRecords";
import type { GeometryKernel } from "./geometryKernel";
import type { FieldGeographyCatalog } from "./fieldGeography";
import { regionSelectionLevel } from "./regionScale";
import { GeosSpatial } from "./geosSpatial";

interface Context {
  reference: World["reference"];
  parent: Geometry;
  parentArea: number;
  precision: number;
  revision: number;
  targetArea: number;
}
type RegionSource = RegionCandidate & { district?: boolean };
const districtPreferencePenalty = 0.2;
const sparseFootprintPenalty = 0.75;
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
    private readFeatures: (query: FeatureQuery) => Promise<FeaturePage>,
    private geography: FieldGeographyCatalog
  ) {}
  private context(query: RegionQuery): Context {
    const { worldId, spaceId } = query.scope;
    const world = this.db.selectObject("SELECT data,revision FROM worlds WHERE id=?", [worldId]);
    requireThat(world, "missing_world", "Choose an existing world.");
    const reference: World["reference"] = JSON.parse(String(world.data)).reference,
      precision = reference.precision ?? 1e-6;
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
      reference,
      parent,
      parentArea: this.kernel.measure(parent, precision).area,
      precision,
      revision: Number(world.revision),
      targetArea: regionalSelectionArea(regionSelectionLevel(this.db, this.kernel, query)),
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
    let clipped = polygonGeometry(kernel.overlay(shape, context.parent, precision, "intersection"));
    if (!clipped) return null;
    for (const sibling of this.siblings(query, kernel.encode(clipped, precision).bounds)) {
      clipped = polygonGeometry(
        kernel.overlay(clipped, sibling.footprint, precision, "difference")
      );
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
  private candidates(query: RegionQuery, context: Context, sources: RegionSource[]) {
    const { kernel } = this,
      { precision, parentArea } = context;
    const unique = new Map<string, { candidate: RegionCandidate; score: number }>();
    for (const source of sources) {
      const available = this.available(query, context, source.footprint);
      if (!available) continue;
      for (const piece of this.split(available, query.cuts, precision))
        for (const shape of connectedRegionParts(context.reference, piece, query.position)) {
          const { area, length } = kernel.measure(shape, precision);
          if (area >= parentArea || (2 * area) / length < minimumRegionWidthMetres) continue;
          if (query.position && !kernel.relation(shape, point(query.position), precision, "covers"))
            continue;
          const footprint = canonicalGeometry(context.reference, shape),
            key = JSON.stringify(kernel.canonical(footprint, precision));
          if (!unique.has(key)) {
            const [w, s, e, n] = this.kernel.encode(shape, precision).bounds;
            const score = candidateScore(
              area,
              (e - w) * (n - s),
              context.targetArea,
              !!source.district
            );
            unique.set(key, { candidate: { name: source.name, footprint }, score });
          }
        }
    }
    return [...unique.values()].sort((a, b) => a.score - b.score).map(({ candidate }) => candidate);
  }
  private async withDistricts(query: RegionQuery, context: Context, sources: RegionCandidate[]) {
    const anchors = await this.settlementCentres(query, context.parent);
    const result: RegionSource[] = [...sources];
    for (const source of sources)
      for (const shape of connectedRegionParts(
        context.reference,
        source.footprint,
        query.position
      )) {
        if (!this.kernel.relation(shape, point(query.position!), context.precision, "covers"))
          continue;
        for (const footprint of regionalDistricts(
          shape,
          context.targetArea,
          localAnchors(context.reference, shape, anchors),
          context.precision
        ))
          result.push({
            name: districtName(source.name, shape, footprint, this.kernel, context.precision),
            footprint: canonicalGeometry(context.reference, footprint),
            district: true,
          });
      }
    return result;
  }
  private async settlementCentres(query: RegionQuery, parent: Geometry) {
    const points: Position[] = [];
    let after: string | null = null;
    do {
      const page = await this.readFeatures({
        scope: query.scope,
        extent: extent(parent),
        layers: ["settlements"],
        geometry: parent,
        predicate: "intersects",
        after,
        limit: 128,
      });
      for (const { feature } of page.records)
        if (feature.geometry.type === "Point") {
          const [x, y, z = 0] = feature.geometry.coordinates;
          points.push({ x, y, z });
        }
      after = page.next;
    } while (after);
    return points;
  }
  /** Cuts divide the indexed polygons they cross. */
  private async cutSources(query: RegionQuery) {
    const sources: RegionCandidate[] = [];
    for (const cut of query.cuts) sources.push(...(await this.polygons(query, cut, "intersects")));
    return sources;
  }
  /** Use the actual physical shore, rather than the approximated edge of a named region. */
  private land(query: RegionQuery, context: Context): Geometry | null {
    for (let areaId: string | null = query.scope.areaId; areaId;) {
      const row = this.db.selectObject(
        `SELECT g.id FROM records f JOIN resources r ON r.id=json_extract(f.data,'$.value.resourceId')
        JOIN field_geography g ON g.id=json_extract(r.data,'$.field.geographyId') AND g.world_id=f.world_id
        WHERE f.world_id=? AND f.area_id=? AND f.kind='field'
        AND json_type(g.data,'$.ocean') IS NOT NULL ORDER BY f.revision DESC LIMIT 1`,
        [query.scope.worldId, areaId]
      );
      if (row) {
        const ocean = this.geography.read({ ...query.scope, areaId }, String(row.id)).ocean;
        return ocean
          ? this.kernel.overlay(context.parent, ocean, context.precision, "difference")
          : context.parent;
      }
      const parent = this.db.selectObject(
        "SELECT json_extract(data,'$.value.parentId') AS parent, json_type(data,'$.value.map') AS owned FROM records WHERE world_id=? AND kind='area' AND id=?",
        [query.scope.worldId, areaId]
      );
      if (parent?.owned) return null;
      areaId = parent?.parent ? String(parent.parent) : null;
    }
    return null;
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
    let sources = query.cuts.length
      ? await this.cutSources(query)
      : await this.polygons(query, point(position), "covers");
    const land = this.land(query, context);
    if (land && this.kernel.relation(land, point(position), context.precision, "covers")) {
      sources = sources.flatMap((source) => {
        const footprint = polygonGeometry(
          this.kernel.overlay(source.footprint, land, context.precision, "intersection")
        );
        return footprint ? [{ ...source, footprint }] : [];
      });
      sources.push({ name: "Landmass", footprint: land });
    }
    return {
      revision: context.revision,
      childId: null,
      candidates: this.candidates(
        query,
        context,
        query.cuts.length ? sources : await this.withDistricts(query, context, sources)
      ),
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
function districtName(
  name: string,
  shape: Geometry,
  district: Geometry,
  kernel: GeometryKernel,
  precision: number
) {
  const gis = new GeosSpatial(kernel, precision),
    [w, s, e, n] = gis.bounds(shape),
    p = gis.interiorPosition(district);
  const x = (p.x - w) / (e - w),
    y = (p.y - s) / (n - s);
  const horizontal = x < 1 / 3 ? "west" : x > 2 / 3 ? "east" : "";
  const vertical = y < 1 / 3 ? "south" : y > 2 / 3 ? "north" : "";
  return `${name} · ${vertical + horizontal || "central"}`;
}
function candidateScore(area: number, frameArea: number, target: number, district: boolean) {
  return (
    Math.abs(Math.log(frameArea / target)) +
    Math.log(Math.max(1, frameArea / area)) * sparseFootprintPenalty +
    (district ? districtPreferencePenalty : 0)
  );
}
function localAnchors(reference: World["reference"], shape: Geometry, anchors: Position[]) {
  if (reference.boundaryMode !== "cylinder") return anchors;
  const [w, , e] = spatial.bounds(reference.domain),
    width = e - w,
    [low, , high] = spatial.bounds(shape),
    centre = (low + high) / 2;
  return anchors.map((p) => ({ ...p, x: p.x + Math.round((centre - p.x) / width) * width }));
}
