import type { Database } from "@sqlite.org/sqlite-wasm";
import {
  rectangle,
  type Bounds,
  type AtlasFeature,
  type RecordReference,
  type WorkspaceScope,
  type WorkspaceChange,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import type { BoundaryIndex } from "./boundaryIndex";
import type { GeometryKernel } from "./geometryKernel";
import type { GeometryDerivations } from "./geometryDerivations";
import type { CatalogProjection } from "./catalogProjection";
import type { FeatureCatalog } from "./featureCatalog";
import { CoastBoundaries } from "./coastBoundaries";
import { CanonicalBoundaries } from "./canonicalBoundaries";

const schema = `
CREATE TABLE IF NOT EXISTS boundary_scopes (
  world_id TEXT NOT NULL,space_id TEXT NOT NULL,area_id TEXT NOT NULL,
  PRIMARY KEY(world_id,space_id,area_id)
);
CREATE TABLE IF NOT EXISTS boundary_dirty (
  world_id TEXT NOT NULL,space_id TEXT NOT NULL,area_id TEXT NOT NULL,feature_id TEXT NOT NULL,
  PRIMARY KEY(world_id,space_id,area_id,feature_id),
  FOREIGN KEY(world_id,space_id,area_id) REFERENCES boundary_scopes ON DELETE CASCADE
);`;
function queryGeometry(b: Bounds): Geometry {
  if (b[0] !== b[2] && b[1] !== b[3]) return rectangle(b);
  if (b[0] === b[2] && b[1] === b[3]) return { type: "Point", coordinates: [b[0], b[1]] };
  return {
    type: "LineString",
    coordinates: [
      [b[0], b[1]],
      [b[2], b[3]],
    ],
  };
}
/** Derived topology is scoped presentation. It never creates another semantic feature. */
export class BoundaryProjection {
  private coasts: CoastBoundaries;
  private canonical: CanonicalBoundaries;
  constructor(
    private db: Database,
    private index: BoundaryIndex,
    private kernel: GeometryKernel,
    derivations: GeometryDerivations,
    private features: FeatureCatalog,
    private projection: CatalogProjection
  ) {
    db.exec(schema);
    this.coasts = new CoastBoundaries(db, index, derivations, projection);
    this.canonical = new CanonicalBoundaries(db, index, derivations);
  }
  /** Install every source intersecting the extent. Reports the covered extent and the bounds of
   * sources whose linework was (re)installed so cached tiles can be dropped. */
  ensure(scope: WorkspaceScope, requested?: Bounds): { covered: Bounds | null; changed: Bounds[] } {
    const context = this.projection.context(scope.worldId, scope.areaId, []);
    const precision = context.world.reference.precision ?? 1e-6;
    const area = this.kernel.withShape(context.scope.footprint, precision, (shape) =>
      this.kernel.bounds(shape)
    );
    const extent: Bounds = requested
      ? [
          Math.max(area[0], requested[0]),
          Math.max(area[1], requested[1]),
          Math.min(area[2], requested[2]),
          Math.min(area[3], requested[3]),
        ]
      : area;
    if (extent[0] > extent[2] || extent[1] > extent[3]) return { covered: null, changed: [] };
    const changed: Bounds[] = [];
    this.db.transaction(() => {
      this.db.exec({
        sql: "INSERT OR IGNORE INTO boundary_scopes VALUES(?,?,?)",
        bind: [scope.worldId, scope.spaceId, scope.areaId],
      });
      this.clearDirty(scope);
      if (this.coasts.ensure(scope, extent)) changed.push(area);
      const handled = this.canonical.install(scope, extent, context.world.areas, precision);
      this.installWindow(scope, extent, handled, changed);
    });
    return { covered: extent, changed };
  }
  private clearDirty(scope: WorkspaceScope) {
    const bind = [scope.worldId, scope.spaceId, scope.areaId];
    this.db.exec({
      sql: `DELETE FROM boundary_sources WHERE world_id=? AND space_id=? AND area_id=?
        AND record_id IN (SELECT r.record_id FROM records_core r JOIN boundary_dirty d
          ON d.world_id=r.world_id AND d.feature_id=r.id WHERE d.world_id=? AND d.space_id=? AND d.area_id=?)`,
      bind: [...bind, ...bind],
    });
    this.db.exec({
      sql: "DELETE FROM boundary_dirty WHERE world_id=? AND space_id=? AND area_id=?",
      bind,
    });
  }
  private installWindow(
    scope: WorkspaceScope,
    extent: Bounds,
    handled: Set<string>,
    changed: Bounds[]
  ) {
    let after: string | null = null;
    const missing = (id: string) =>
      !handled.has(id) &&
      !this.db.selectValue(
        `SELECT 1 FROM boundary_sources s JOIN records_core r USING(record_id)
        WHERE s.world_id=? AND s.space_id=? AND s.area_id=? AND r.id=? LIMIT 1`,
        [scope.worldId, scope.spaceId, scope.areaId, id]
      );
    do {
      const page = this.features.read(
        {
          scope,
          extent,
          geometry: queryGeometry(extent),
          predicate: "intersects",
          layers: [],
          after,
          limit: 64,
        },
        undefined,
        missing
      );
      for (const { feature } of page.records) {
        const bounds = this.install(scope, feature);
        if (bounds) changed.push(bounds);
      }
      after = page.next;
    } while (after);
  }
  private recordId(worldId: string, id: string) {
    return this.db.selectValue(
      "SELECT record_id FROM records WHERE world_id=? AND kind IN ('feature','landmark','magic') AND id=? ORDER BY CASE kind WHEN 'landmark' THEN 0 WHEN 'magic' THEN 1 ELSE 2 END LIMIT 1",
      [worldId, id]
    );
  }
  private install(scope: WorkspaceScope, feature: AtlasFeature): Bounds | null {
    const recordId = this.recordId(scope.worldId, feature.id);
    if (recordId === undefined) return null;
    const precision = this.projection.metadata(scope.worldId).reference.precision ?? 1e-6;
    const geometry = feature.footprint ?? feature.geometry;
    const encoded = this.kernel.encode(geometry, precision);
    return this.index.refresh(Number(recordId), scope, encoded.bytes) ? encoded.bounds : null;
  }
  changed(worldId: string, reference: RecordReference): WorkspaceChange["extents"] {
    if (reference.kind === "area") return this.changedArea(worldId);
    const ids = this.affected(worldId, reference);
    if (!ids.length) return [];
    const extents = this.db
      .selectObjects(
        `SELECT s.space_id,min(b.min_x) west,min(b.min_y) south,max(b.max_x) east,max(b.max_y) north
      FROM boundary_sources s JOIN records r ON r.record_id=s.record_id JOIN boundary_segments e ON e.source_id=s.source_id JOIN boundary_bounds b USING(segment_id)
      WHERE r.world_id=? AND r.id IN (SELECT value FROM json_each(?)) GROUP BY s.space_id`,
        [worldId, JSON.stringify(ids)]
      )
      .map((row) => ({
        spaceId: String(row.space_id),
        bounds: [
          Number(row.west),
          Number(row.south),
          Number(row.east),
          Number(row.north),
        ] as Bounds,
      }));
    this.db.exec({
      sql: `INSERT OR IGNORE INTO boundary_dirty SELECT s.world_id,s.space_id,s.area_id,j.value
      FROM boundary_scopes s CROSS JOIN json_each(?) j WHERE s.world_id=?`,
      bind: [JSON.stringify(ids), worldId],
    });
    return extents;
  }
  private changedArea(worldId: string): WorkspaceChange["extents"] {
    const extents = this.db
      .selectObjects(
        `SELECT s.space_id,min(b.min_x) west,min(b.min_y) south,max(b.max_x) east,max(b.max_y) north
      FROM boundary_sources s JOIN boundary_segments e ON e.source_id=s.source_id JOIN boundary_bounds b USING(segment_id)
      WHERE s.world_id=? GROUP BY s.space_id`,
        [worldId]
      )
      .map((row) => ({
        spaceId: String(row.space_id),
        bounds: [
          Number(row.west),
          Number(row.south),
          Number(row.east),
          Number(row.north),
        ] as Bounds,
      }));
    this.db.exec({
      sql: `INSERT OR IGNORE INTO boundary_dirty SELECT s.world_id,s.space_id,s.area_id,r.id
      FROM boundary_scopes s JOIN records r ON r.world_id=s.world_id AND r.kind IN ('feature','landmark','magic') WHERE s.world_id=?`,
      bind: [worldId],
    });
    return extents;
  }
  private affected(worldId: string, reference: RecordReference) {
    const id =
      reference.kind === "representation"
        ? this.db.selectValue(
            "SELECT json_extract(data,'$.value.featureId') FROM records WHERE world_id=? AND kind='representation' AND id=?",
            [worldId, reference.id]
          )
        : ["feature", "landmark", "magic"].includes(reference.kind)
          ? reference.id
          : null;
    if (!id) return [];
    return this.db
      .selectValues(
        `WITH RECURSIVE affected(id) AS (SELECT ? UNION SELECT r.id FROM affected a
      JOIN record_links l ON l.world_id=? AND l.target=a.id AND l.relation='follows' JOIN records r ON r.record_id=l.source AND r.kind='feature') SELECT id FROM affected`,
        [id, worldId]
      )
      .map(String);
  }
}
