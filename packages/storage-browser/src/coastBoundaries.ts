import type { Database } from "@sqlite.org/sqlite-wasm";
import { spatial, type Bounds, type WorkspaceScope } from "@atlas/domain";
import type { BoundaryIndex } from "./boundaryIndex";
import type { BoundaryTiles } from "./boundaryTiles";
import type { CatalogProjection } from "./catalogProjection";
import { geometryBoundaryWindow, writeGeometryBoundaries } from "./geometryBoundaries";

/** Coast pieces participate in the same local topology as feature and authored boundaries. */
export class CoastBoundaries {
  constructor(
    private db: Database,
    private index: BoundaryIndex,
    private tiles: BoundaryTiles,
    private projection: CatalogProjection
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS boundary_coasts (
      world_id TEXT NOT NULL,space_id TEXT NOT NULL,area_id TEXT NOT NULL,signature TEXT NOT NULL,
      PRIMARY KEY(world_id,space_id,area_id));`);
  }
  ensure(scope: WorkspaceScope, extent: Bounds) {
    const fields = this.db.selectObjects(
      `WITH RECURSIVE lineage(id) AS (SELECT ? UNION
      SELECT json_extract(r.data,'$.value.parentId') FROM records r JOIN lineage l ON r.id=l.id
      WHERE r.world_id=? AND r.kind='area' AND json_extract(r.data,'$.value.parentId') IS NOT NULL)
      SELECT min(r.record_id) record_id,json_extract(resource.data,'$.field.geographyId') geography_id
      FROM records r JOIN resources resource ON resource.id=json_extract(r.data,'$.value.resourceId')
      WHERE r.world_id=? AND r.space_id=? AND r.kind='field' AND r.area_id IN (SELECT id FROM lineage)
      AND EXISTS(SELECT 1 FROM json_each(r.data,'$.value.channels') WHERE value='elevation')
      GROUP BY geography_id ORDER BY geography_id`,
      [scope.areaId, scope.worldId, scope.worldId, scope.spaceId]
    );
    const signature = JSON.stringify(fields),
      bind = [scope.worldId, scope.spaceId, scope.areaId];
    const unchanged =
      this.db.selectValue(
        "SELECT signature FROM boundary_coasts WHERE world_id=? AND space_id=? AND area_id=?",
        bind
      ) === signature;
    if (!unchanged) this.reset(scope, signature);
    for (const field of fields)
      this.install(scope, Number(field.record_id), String(field.geography_id), extent);
  }
  private reset(scope: WorkspaceScope, signature: string) {
    const bind = [scope.worldId, scope.spaceId, scope.areaId];
    this.db.exec({
      sql: `DELETE FROM boundary_sources WHERE world_id=? AND space_id=? AND area_id=?
      AND record_id IN (SELECT record_id FROM records WHERE world_id=? AND kind='field')`,
      bind: [...bind, scope.worldId],
    });
    this.db.exec({
      sql: `INSERT INTO boundary_coasts VALUES(?,?,?,?) ON CONFLICT(world_id,space_id,area_id)
      DO UPDATE SET signature=excluded.signature`,
      bind: [...bind, signature],
    });
    const context = this.projection.context(scope.worldId, scope.areaId, []);
    this.tiles.invalidate(scope, spatial.bounds(context.scope.footprint));
  }
  private install(scope: WorkspaceScope, recordId: number, geographyId: string, b: Bounds) {
    const statement = this.db.prepare(`SELECT p.geometry_id FROM field_geometry_parts p
      JOIN field_geometry_bounds b USING(part_id)
      WHERE p.world_id=? AND p.geography_id=? AND p.role='ocean'
      AND b.min_x<=? AND b.max_x>=? AND b.min_y<=? AND b.max_y>=?
      ORDER BY p.part_id`);
    try {
      statement.bind([scope.worldId, geographyId, b[2], b[0], b[3], b[1]]);
      while (statement.step()) {
        const row = statement.get({}),
          geometryId = Number(row.geometry_id),
          precision = this.projection.metadata(scope.worldId).reference.precision ?? 1e-6;
        writeGeometryBoundaries(this.db, this.tiles.kernel, geometryId, precision);
        for (const part of geometryBoundaryWindow(this.db, geometryId, b))
          this.index.refresh(recordId, scope, part.bytes, part.partId);
      }
    } finally {
      statement.finalize();
    }
  }
}
