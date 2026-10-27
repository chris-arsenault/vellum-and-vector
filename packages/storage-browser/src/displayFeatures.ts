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
import { geometryPieceMatches, geometryWindow, writeGeometryPieces } from "./geometryPieces";

/** Canonical edits still read complete objects. Map products read spatial pieces and overviews. */
export class DisplayFeatures {
  constructor(
    private db: Database,
    private kernel: GeometryKernel
  ) {}
  read(
    query: FeatureQuery,
    row: CatalogRow,
    context: DomainSnapshot,
    tolerance: number,
    target: number
  ): AtlasFeature | null | undefined {
    if (row.kind !== "feature" || query.predicate !== "intersects") return undefined;
    const feature = (JSON.parse(String(row.data)) as { value: AtlasFeature }).value;
    if (!this.uncomposed(query.scope.worldId, feature)) return undefined;
    const owner = context.world.areas[feature.areaId],
      area = context.world.areas[query.scope.areaId];
    if (!owner || profiles.indexOf(owner.profile) > profiles.indexOf(area.profile)) return null;
    const precision = context.world.reference.precision ?? 1e-6,
      geometryId = Number(row.geometry_id),
      footprintId = Number(row.footprint_id);
    writeGeometryPieces(this.db, this.kernel, geometryId, precision);
    if (footprintId) writeGeometryPieces(this.db, this.kernel, footprintId, precision);
    if (!this.matches(geometryId, footprintId, query.extent, target)) return null;
    const inArea = this.kernel.withGeometry(area.footprint, precision, (mask) =>
      this.matches(geometryId, footprintId, this.kernel.bounds(mask), mask)
    );
    if (!inArea) return null;
    return this.window(feature, geometryId, footprintId, query.extent, precision, tolerance);
  }
  private window(
    feature: AtlasFeature,
    geometryId: number,
    footprintId: number,
    b: Bounds,
    precision: number,
    tolerance: number
  ) {
    const gutter = Math.max(precision * 2, tolerance * 128),
      window: Bounds = [b[0] - gutter, b[1] - gutter, b[2] + gutter, b[3] + gutter];
    const geometry = geometryWindow(this.db, this.kernel, geometryId, window, precision, tolerance);
    // A distant glyph or course can have a local affected footprint; retain that full presentation.
    if (!geometry) return undefined;
    const footprint = footprintId
      ? geometryWindow(this.db, this.kernel, footprintId, window, precision, tolerance)
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
  private matches(geometryId: number, footprintId: number, bounds: Bounds, target: number) {
    return (
      geometryPieceMatches(this.db, this.kernel, geometryId, bounds, target) ||
      (!!footprintId && geometryPieceMatches(this.db, this.kernel, footprintId, bounds, target))
    );
  }
}
