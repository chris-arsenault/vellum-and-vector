import type { Database } from "@sqlite.org/sqlite-wasm";
import {
  presentAtlasFeature,
  canonicalFeatures,
  rectangle,
  requireThat,
  type AtlasFeature,
  type FeaturePage,
  type FeatureQuery,
  type WorkspaceScope,
} from "@atlas/domain";
import { ByteCache } from "./byteCache";
import { CatalogProjection } from "./catalogProjection";
import type { CatalogRow } from "./catalogRecords";
import type { GeometryKernel } from "./geometryKernel";
import { DisplayFeatures } from "./displayFeatures";

interface Presented {
  feature: AtlasFeature;
  geometry: Uint8Array;
  footprint: Uint8Array | null;
  revision: number;
  key: string;
}
export const composedFeatureCacheBytes = 16 * 1024 * 1024;
/** Canonical identity is stored once; presentation is derived from its actual read revisions. */
export class FeatureCatalog {
  private cache = new ByteCache<string, Presented>(composedFeatureCacheBytes);
  private display = new ByteCache<string, AtlasFeature>(composedFeatureCacheBytes);
  private windows: DisplayFeatures;
  constructor(
    private db: Database,
    private kernel: GeometryKernel,
    private projection: CatalogProjection
  ) {
    this.windows = new DisplayFeatures(db, kernel);
  }
  read(
    query: FeatureQuery,
    tolerance: number | undefined = undefined,
    accept: (id: string) => boolean = () => true
  ): FeaturePage {
    requireThat(
      tolerance === undefined || (Number.isFinite(tolerance) && tolerance >= 0),
      "display_tolerance",
      "Display tolerance is a nonnegative metre distance."
    );
    requireThat(
      Number.isSafeInteger(query.limit) && query.limit > 0,
      "query_limit",
      "Query needs a positive page size."
    );
    const context = this.projection.context(query.scope.worldId, query.scope.areaId, []);
    requireThat(
      context.scope.spaceId === query.scope.spaceId,
      "query_space",
      "Choose the area's located space."
    );
    const precision = context.world.reference.precision ?? 1e-6;
    return this.kernel.withGeometry(
      query.geometry ?? rectangle(query.extent),
      precision,
      (target) => this.page(query, target, precision, tolerance, accept, context)
    );
  }
  private page(
    query: FeatureQuery,
    target: number,
    precision: number,
    tolerance: number | undefined,
    accept: (id: string) => boolean,
    context: ReturnType<CatalogProjection["context"]>
  ): FeaturePage {
    const records: FeaturePage["records"] = [];
    let after = query.after ?? "";
    while (records.length <= query.limit) {
      const rows = this.candidates(query, after);
      if (!rows.length) break;
      for (const row of rows) {
        after = String(row.id);
        if (!accept(after)) continue;
        const item = this.item(query, row, precision, tolerance, target, context);
        if (item) records.push(item);
        if (records.length > query.limit) break;
      }
    }
    const more = records.length > query.limit;
    records.length = Math.min(records.length, query.limit);
    return { records, next: more ? records.at(-1)!.feature.id : null };
  }
  private item(
    query: FeatureQuery,
    row: CatalogRow,
    precision: number,
    tolerance: number | undefined,
    target: number,
    context: ReturnType<CatalogProjection["context"]>
  ) {
    if (tolerance !== undefined) {
      const feature = this.windows.read(query, row, context, tolerance, target);
      if (feature !== undefined)
        return feature ? { feature, revision: Number(row.revision) } : null;
    }
    const presented = this.present(query, row, precision);
    if (!presented || !this.matches(presented, target, query.predicate)) return null;
    return {
      feature: structuredClone(this.product(presented, precision, tolerance ?? 0)),
      revision: presented.revision,
    };
  }
  private product(item: Presented, precision: number, tolerance: number) {
    if (!tolerance) return item.feature;
    const key = `${item.key}:${tolerance}`;
    const previous = this.display.get(key);
    if (previous) return previous;
    const feature = {
      ...item.feature,
      geometry: this.kernel.simplify(item.feature.geometry, precision, tolerance),
      ...(item.feature.footprint
        ? { footprint: this.kernel.simplify(item.feature.footprint, precision, tolerance) }
        : {}),
    };
    this.display.set(key, feature, JSON.stringify(feature).length * 2);
    return feature;
  }
  one(scope: WorkspaceScope, id: string) {
    const row = this.db.selectObject(
      "SELECT * FROM records WHERE world_id=? AND kind IN ('feature','landmark','magic') AND id=? ORDER BY CASE kind WHEN 'landmark' THEN 0 WHEN 'magic' THEN 1 ELSE 2 END LIMIT 1",
      [scope.worldId, id]
    );
    if (!row) return null;
    const precision = this.projection.metadata(scope.worldId).reference.precision ?? 1e-6;
    return this.present(
      {
        scope,
        extent: [0, 0, 0, 0],
        geometry: null,
        predicate: "intersects",
        layers: [],
        after: null,
        limit: 1,
      },
      row,
      precision
    );
  }
  private candidates(query: FeatureQuery, after: string) {
    const { worldId, spaceId, areaId } = query.scope,
      b = query.extent;
    return this.db.selectObjects(
      `WITH RECURSIVE
      lineage(id) AS (SELECT ? UNION SELECT json_extract(a.data,'$.value.parentId') FROM records a JOIN lineage l ON a.id=l.id WHERE a.world_id=? AND a.kind='area' AND json_extract(a.data,'$.value.parentId') IS NOT NULL),
      spatial(id) AS (SELECT CASE WHEN r.kind='representation' THEN json_extract(r.data,'$.value.featureId') ELSE r.id END FROM records r JOIN record_bounds b USING(record_id) WHERE r.world_id=? AND r.space_id=? AND r.kind IN ('feature','representation','landmark','magic') AND b.min_x<=? AND b.max_x>=? AND b.min_y<=? AND b.max_y>=?
        UNION SELECT f.id FROM spatial s JOIN record_links l ON l.world_id=? AND l.target=s.id AND l.relation='follows' JOIN records f ON f.record_id=l.source AND f.kind='feature')
      SELECT r.* FROM records_core r WHERE r.world_id=? AND r.space_id=? AND r.kind IN ('feature','landmark','magic')
      AND (r.kind<>'feature' OR NOT EXISTS(SELECT 1 FROM records source WHERE source.world_id=r.world_id AND source.id=r.id AND source.kind IN ('landmark','magic')))
      AND r.area_id IN (SELECT id FROM lineage) AND r.id IN (SELECT id FROM spatial) AND r.id>?
      AND (?=0 OR r.layer_id IN (SELECT value FROM json_each(?))) ORDER BY r.id LIMIT ?`,
      [
        areaId,
        worldId,
        worldId,
        spaceId,
        b[2],
        b[0],
        b[3],
        b[1],
        worldId,
        worldId,
        spaceId,
        after,
        query.layers.length,
        JSON.stringify(query.layers),
        Math.max(64, query.limit + 1),
      ]
    );
  }
  private present(query: FeatureQuery, row: CatalogRow, precision: number) {
    const context = this.projection.context(query.scope.worldId, query.scope.areaId, [
      String(row.id),
    ]);
    const key = JSON.stringify([
      query.scope.worldId,
      query.scope.areaId,
      ...context.revisions.map((r) => [r.kind, r.id, r.version]),
    ]);
    const previous = this.cache.get(key);
    if (previous) return previous;
    const gis = {
      buffer: (value: import("geojson").Geometry, distance: number) =>
        this.kernel.buffer(value, distance, precision),
      intersection: (a: import("geojson").Geometry, b: import("geojson").Geometry) =>
        this.kernel.overlay(a, b, precision, "intersection"),
      difference: (a: import("geojson").Geometry, b: import("geojson").Geometry) =>
        this.kernel.overlay(a, b, precision, "difference"),
      union: (a: import("geojson").Geometry, b: import("geojson").Geometry) =>
        this.kernel.overlay(a, b, precision, "union")!,
      intersects: (a: import("geojson").Geometry, b: import("geojson").Geometry) =>
        this.kernel.relation(a, b, precision, "intersects"),
    };
    const source = canonicalFeatures(context.world, gis).find(
      (feature) => feature.id === String(row.id)
    );
    requireThat(source, "missing_feature", "Choose an existing geographic feature.");
    const feature = presentAtlasFeature(context.world, source, query.scope.areaId, gis);
    if (!feature) return null;
    const geometry = this.kernel.encode(feature.geometry, precision).bytes;
    const footprint = feature.footprint
      ? this.kernel.encode(feature.footprint, precision).bytes
      : null;
    const result: Presented = {
      feature: { ...feature, detail: {} },
      geometry,
      footprint,
      revision: context.revisions.reduce(
        (latest, ref) => Math.max(latest, ref.version),
        Number(row.revision)
      ),
      key,
    };
    this.cache.set(
      key,
      result,
      JSON.stringify(result.feature).length * 2 + geometry.byteLength + (footprint?.byteLength ?? 0)
    );
    return result;
  }
  private matches(item: Presented, target: number, predicate: FeatureQuery["predicate"]) {
    return (
      this.kernel.matches(`${item.key}:geometry`, item.geometry, target, predicate) ||
      Boolean(
        item.footprint &&
        this.kernel.matches(`${item.key}:footprint`, item.footprint, target, predicate)
      )
    );
  }
}
