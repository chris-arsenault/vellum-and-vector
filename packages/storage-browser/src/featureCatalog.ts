import type { Database } from "@sqlite.org/sqlite-wasm";
import {
  presentAtlasFeature,
  ownsMapGeography,
  canonicalFeatures,
  rectangle,
  requireThat,
  type AtlasFeature,
  type Bounds,
  type FeaturePage,
  type FeatureQuery,
  type WorkspaceScope,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import { CatalogProjection } from "./catalogProjection";
import type { ComposedFeatures, StoredComposition } from "./composedFeatures";
import type { CatalogRow } from "./catalogRecords";
import type { GeometryKernel } from "./geometryKernel";
import type { GeometryDerivations } from "./geometryDerivations";
import { DisplayFeatures, type DisplayQuery } from "./displayFeatures";

export interface Presented {
  feature: AtlasFeature;
  geometry: Uint8Array;
  footprint: Uint8Array | null;
  geometryId: number;
  footprintId: number | null;
  revision: number;
  /** Prepared-geometry cache identity; stored geometry rows are immutable. */
  key: string;
}
function presented(stored: StoredComposition): Presented {
  return { ...stored, key: `composed:${stored.geometryId}:${stored.footprintId ?? ""}` };
}
function rectangular(geometry: Geometry, bounds: Bounds) {
  if (geometry.type !== "Polygon" || geometry.coordinates.length !== 1) return false;
  const ring = geometry.coordinates[0];
  return (
    ring.length === 5 &&
    ring.every(
      ([x, y]) => (x === bounds[0] || x === bounds[2]) && (y === bounds[1] || y === bounds[3])
    )
  );
}
/** Canonical identity is stored once. A query composes its missing products from one context
 * and stores them; a product is composed again only after one of its input records changes. */
export class FeatureCatalog {
  private windows: DisplayFeatures;
  constructor(
    private db: Database,
    private kernel: GeometryKernel,
    private projection: CatalogProjection,
    private derivations: GeometryDerivations,
    private composed: ComposedFeatures
  ) {
    this.windows = new DisplayFeatures(db, kernel, derivations);
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
    const precision = context.world.reference.precision ?? 1e-6,
      area = context.world.areas[query.scope.areaId];
    return this.kernel.withShape(query.geometry ?? rectangle(query.extent), precision, (target) =>
      this.kernel.withShape(area.footprint, precision, (areaMask) => {
        const areaBounds = this.kernel.bounds(areaMask);
        const display: DisplayQuery | null =
          tolerance === undefined
            ? null
            : {
                query,
                context,
                tolerance,
                target,
                precision,
                areaMask,
                areaBounds,
                areaRectangular: rectangular(area.footprint, areaBounds),
              };
        return this.page(query, target, precision, tolerance, accept, display);
      })
    );
  }
  private page(
    query: FeatureQuery,
    target: number,
    precision: number,
    tolerance: number | undefined,
    accept: (id: string) => boolean,
    display: DisplayQuery | null
  ): FeaturePage {
    const records: FeaturePage["records"] = [];
    let after = query.after ?? "";
    while (records.length <= query.limit) {
      const rows = this.candidates(query, after);
      if (!rows.length) break;
      after = String(rows.at(-1)!.id);
      const accepted = rows.filter((row) => accept(String(row.id)));
      for (const item of this.items(query, accepted, target, precision, tolerance, display)) {
        if (item) records.push(item);
        if (records.length > query.limit) break;
      }
    }
    const more = records.length > query.limit;
    records.length = Math.min(records.length, query.limit);
    return { records, next: more ? records.at(-1)!.feature.id : null };
  }
  /** Display rows answer directly; the rest are composed together from one context. */
  private items(
    query: FeatureQuery,
    rows: CatalogRow[],
    target: number,
    precision: number,
    tolerance: number | undefined,
    display: DisplayQuery | null
  ) {
    const pending: { row: CatalogRow; slot: number }[] = [];
    const page: (FeaturePage["records"][number] | null)[] = [];
    for (const row of rows) {
      const shown = display ? this.windows.read(display, row) : undefined;
      if (shown !== undefined)
        page.push(shown ? { feature: shown, revision: Number(row.revision) } : null);
      else {
        pending.push({ row, slot: page.length });
        page.push(null);
      }
    }
    const presented = this.presentRows(
      query.scope,
      pending.map((p) => p.row),
      precision
    );
    for (const { row, slot } of pending) {
      const item = presented.get(String(row.id));
      if (!item || !this.matches(item, target, query.predicate)) continue;
      page[slot] = {
        feature: structuredClone(this.product(item, precision, tolerance ?? 0)),
        revision: item.revision,
      };
    }
    return page;
  }
  /** Display simplification of a stored product, itself stored per tolerance. */
  private product(item: Presented, precision: number, tolerance: number) {
    if (!tolerance) return item.feature;
    return {
      ...item.feature,
      geometry: this.derivations.whole(item.geometryId, precision, tolerance),
      ...(item.footprintId !== null
        ? { footprint: this.derivations.whole(item.footprintId, precision, tolerance) }
        : {}),
    };
  }
  one(scope: WorkspaceScope, id: string) {
    return this.many(scope, [id]).get(id) ?? null;
  }
  /** Present several features of one scope from a single context. */
  many(scope: WorkspaceScope, ids: string[]) {
    if (!ids.length) return new Map<string, Presented>();
    const context = this.projection.context(scope.worldId, scope.areaId, []),
      owner = ownsMapGeography(context.world, scope.areaId) ? scope.areaId : null;
    const rows = this.db.selectObjects(
      `SELECT * FROM records WHERE world_id=? AND kind IN ('feature','landmark','magic')
      AND id IN (SELECT value FROM json_each(?))
      AND (? IS NULL OR area_id=?)
      ORDER BY id,CASE kind WHEN 'landmark' THEN 0 WHEN 'magic' THEN 1 ELSE 2 END`,
      [scope.worldId, JSON.stringify(ids), owner, owner]
    );
    const first = new Map<string, CatalogRow>();
    for (const row of rows) if (!first.has(String(row.id))) first.set(String(row.id), row);
    const precision = this.projection.metadata(scope.worldId).reference.precision ?? 1e-6;
    return this.presentRows(scope, [...first.values()], precision);
  }
  /** Window candidates join the R-tree to each feature's stored reach: its own records, its
   * representations and those of the features it follows. */
  private candidates(query: FeatureQuery, after: string) {
    const { worldId, spaceId, areaId } = query.scope,
      b = query.extent;
    this.composed.reach(worldId);
    return this.db.selectObjects(
      `WITH RECURSIVE
      lineage(id) AS (SELECT ? UNION SELECT json_extract(a.data,'$.value.parentId') FROM records_core a JOIN lineage l ON a.id=l.id WHERE a.world_id=? AND a.kind='area' AND json_type(a.data,'$.value.map') IS NULL AND json_extract(a.data,'$.value.parentId') IS NOT NULL),
      spatial(id) AS (SELECT f.feature_id FROM record_bounds b JOIN feature_reach f ON f.record_id=b.record_id AND f.world_id=?
        WHERE b.min_x<=? AND b.max_x>=? AND b.min_y<=? AND b.max_y>=?)
      SELECT r.*,b.min_x,b.min_y,b.max_x,b.max_y FROM records_core r LEFT JOIN record_bounds b USING(record_id)
      WHERE r.world_id=? AND r.space_id=? AND r.kind IN ('feature','landmark','magic')
      AND (r.kind<>'feature' OR NOT EXISTS(SELECT 1 FROM records_core source WHERE source.world_id=r.world_id AND source.id=r.id AND source.kind IN ('landmark','magic')))
      AND r.area_id IN (SELECT id FROM lineage) AND r.id IN (SELECT id FROM spatial) AND r.id>?
      AND (?=0 OR r.layer_id IN (SELECT value FROM json_each(?)))
      AND (?=0 OR r.geometry_type IN ('Polygon','MultiPolygon')) ORDER BY r.id LIMIT ?`,
      [
        areaId,
        worldId,
        worldId,
        b[2],
        b[0],
        b[3],
        b[1],
        worldId,
        spaceId,
        after,
        query.layers.length,
        JSON.stringify(query.layers),
        Number(query.dimension === "polygon"),
        Math.max(64, query.limit + 1),
      ]
    );
  }
  /** Read stored products; compose only the missing ones, from one context, and store them. */
  private presentRows(scope: WorkspaceScope, rows: CatalogRow[], precision: number) {
    const result = new Map<string, Presented>();
    if (!rows.length) return result;
    const stored = this.composed.read(
      scope.worldId,
      scope.areaId,
      rows.map((row) => String(row.id))
    );
    const missing: CatalogRow[] = [];
    for (const row of rows) {
      const item = stored.get(String(row.id));
      if (item) result.set(String(row.id), presented(item));
      else if (item === undefined) missing.push(row);
    }
    if (missing.length) this.compose(scope, missing, precision, result);
    return result;
  }
  private compose(
    scope: WorkspaceScope,
    missing: CatalogRow[],
    precision: number,
    result: Map<string, Presented>
  ) {
    const context = this.projection.context(
      scope.worldId,
      scope.areaId,
      missing.map((row) => String(row.id))
    );
    const gis = {
      buffer: (value: Geometry, distance: number) => this.kernel.buffer(value, distance, precision),
      intersection: (a: Geometry, b: Geometry) =>
        this.kernel.overlay(a, b, precision, "intersection"),
      difference: (a: Geometry, b: Geometry) => this.kernel.overlay(a, b, precision, "difference"),
      union: (a: Geometry, b: Geometry) => this.kernel.overlay(a, b, precision, "union")!,
      intersects: (a: Geometry, b: Geometry) => this.kernel.relation(a, b, precision, "intersects"),
    };
    const sources = new Map(canonicalFeatures(context.world, gis).map((f) => [f.id, f]));
    const latest = context.revisions.reduce((max, ref) => Math.max(max, ref.version), 0);
    for (const row of missing) {
      const id = String(row.id),
        source = sources.get(id);
      requireThat(source, "missing_feature", "Choose an existing geographic feature.");
      const feature = presentAtlasFeature(context.world, source, scope.areaId, gis);
      const record = {
        id,
        geometryId: row.geometry_id === null ? null : Number(row.geometry_id),
        footprintId: row.footprint_id === null ? null : Number(row.footprint_id),
      };
      if (!feature) {
        this.composed.write(scope.worldId, scope.areaId, record, null);
        continue;
      }
      const product = {
        feature: { ...feature, detail: {} },
        geometry: this.kernel.encode(feature.geometry, precision).bytes,
        footprint: feature.footprint
          ? this.kernel.encode(feature.footprint, precision).bytes
          : null,
        revision: Math.max(latest, Number(row.revision)),
      };
      const ids = this.composed.write(scope.worldId, scope.areaId, record, product)!;
      result.set(id, presented({ ...product, ...ids }));
    }
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
