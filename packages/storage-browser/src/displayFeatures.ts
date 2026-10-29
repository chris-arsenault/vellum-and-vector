import type { Database } from "@sqlite.org/sqlite-wasm";
import {
  profiles,
  type AtlasFeature,
  type Bounds,
  type DomainSnapshot,
  type FeatureQuery,
} from "@atlas/domain";
import type { CatalogRow } from "./catalogRecords";
import type { GeometryKernel } from "./geometryKernel";
import type { GeometryDerivations } from "./geometryDerivations";

/** Per-query state prepared once: the query shape, the area mask and its bounds. */
export interface DisplayQuery {
  query: FeatureQuery;
  context: DomainSnapshot;
  tolerance: number;
  target: number;
  precision: number;
  areaMask: number;
  areaBounds: Bounds;
  areaRectangular: boolean;
}
function rowBounds(row: CatalogRow): Bounds | null {
  if (row.min_x === null || row.min_x === undefined) return null;
  return [Number(row.min_x), Number(row.min_y), Number(row.max_x), Number(row.max_y)];
}
function inside(inner: Bounds, outer: Bounds) {
  return (
    inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3]
  );
}
/** Canonical edits still read complete objects. Map products read spatial pieces and overviews. */
export class DisplayFeatures {
  constructor(
    private db: Database,
    private kernel: GeometryKernel,
    private derivations: GeometryDerivations
  ) {}
  /** undefined: the row needs composition; null: not shown; otherwise the display feature. */
  read(display: DisplayQuery, row: CatalogRow): AtlasFeature | null | undefined {
    const feature = this.uncomposedRow(display, row);
    if (!feature) return feature;
    const { query, context, tolerance, precision } = display;
    const owner = context.world.areas[feature.areaId],
      area = context.world.areas[query.scope.areaId];
    if (!owner || profiles.indexOf(owner.profile) > profiles.indexOf(area.profile)) return null;
    const geometryId = Number(row.geometry_id),
      footprintId = Number(row.footprint_id),
      bounds = rowBounds(row);
    if (!this.visible(display, geometryId, footprintId, bounds)) return null;
    const gutter = Math.max(precision * 2, tolerance * 128),
      b = query.extent,
      window: Bounds = [b[0] - gutter, b[1] - gutter, b[2] + gutter, b[3] + gutter];
    // Small features: the whole geometry at the display scale, no clipping, cached per tolerance.
    if (bounds && inside(bounds, window)) {
      const geometry = this.derivations.whole(geometryId, precision, tolerance);
      const footprint = footprintId
        ? this.derivations.whole(footprintId, precision, tolerance)
        : null;
      return { ...feature, geometry, ...(footprint ? { footprint } : {}), detail: {} };
    }
    return this.window(feature, geometryId, footprintId, window, precision, tolerance);
  }
  private uncomposedRow(display: DisplayQuery, row: CatalogRow) {
    if (row.kind !== "feature" || display.query.predicate !== "intersects") return undefined;
    const feature = (JSON.parse(String(row.data)) as { value: AtlasFeature }).value;
    return this.uncomposed(display.query.scope.worldId, feature) ? feature : undefined;
  }
  /** Intersects the query shape and lies in the presentation area. */
  private visible(
    display: DisplayQuery,
    geometryId: number,
    footprintId: number,
    bounds: Bounds | null
  ) {
    const p = display.precision;
    if (!this.matches(geometryId, footprintId, display.query.extent, display.target, p))
      return false;
    if (display.areaRectangular && bounds && inside(bounds, display.areaBounds)) return true;
    return this.matches(geometryId, footprintId, display.areaBounds, display.areaMask, p);
  }
  private window(
    feature: AtlasFeature,
    geometryId: number,
    footprintId: number,
    window: Bounds,
    precision: number,
    tolerance: number
  ) {
    const geometry = this.derivations.window(geometryId, window, precision, tolerance);
    // A distant glyph or course can have a local affected footprint; retain that full presentation.
    if (!geometry) return undefined;
    const footprint = footprintId
      ? this.derivations.window(footprintId, window, precision, tolerance)
      : null;
    return { ...feature, geometry, ...(footprint ? { footprint } : {}), detail: {} };
  }
  private uncomposed(worldId: string, feature: AtlasFeature) {
    return (
      !Object.keys(feature.detail).length &&
      !feature.relations.some((relation) => relation.kind === "follows") &&
      !this.db.selectValue(
        `SELECT 1 FROM records_core WHERE world_id=? AND kind='representation'
        AND json_extract(data,'$.value.featureId')=? LIMIT 1`,
        [worldId, feature.id]
      )
    );
  }
  private matches(
    geometryId: number,
    footprintId: number,
    bounds: Bounds,
    target: number,
    precision: number
  ) {
    return (
      this.derivations.matches(geometryId, bounds, target, precision) ||
      (!!footprintId && this.derivations.matches(footprintId, bounds, target, precision))
    );
  }
}
