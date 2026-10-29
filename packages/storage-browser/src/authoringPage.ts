import type { Database } from "@sqlite.org/sqlite-wasm";
import { requireThat, type AuthoringFeatureQuery } from "@atlas/domain";
import type { GeometryKernel } from "./geometryKernel";

/** Traverse identities in SQL; geometry is decoded only for the returned page. */
export function authoringFeatureIds(
  db: Database,
  kernel: GeometryKernel,
  input: AuthoringFeatureQuery,
  after: string | null,
  limit: number,
  precision: number
) {
  requireThat(Number.isInteger(limit) && limit > 0, "page_size", "Choose a positive page size.");
  const b = kernel.encode(input.scope.footprint, precision).bounds;
  const independent = db.selectValue(
    "SELECT json_type(data,'$.value.map') IS NOT NULL OR json_extract(data,'$.value.parentId') IS NULL FROM records_core WHERE world_id=? AND kind='area' AND id=?",
    [input.scope.worldId, input.scope.areaId]
  );
  const relations = input.dependencies
    ? ["follows", "dependsOn", "boundedBy", "feature", "node"]
    : ["follows", "dependsOn"];
  // The recursive queue supplies one identity. Keep it outside the indexed lookups;
  // SQLite otherwise estimates a large queue and scans the world's records for each row.
  return db
    .selectValues(
      `WITH RECURSIVE
    roots(id) AS (
      SELECT r.id FROM records_core r WHERE r.world_id=? AND r.kind='feature' AND (?=0 OR r.area_id=?) AND (
        r.id IN (SELECT value FROM json_each(?)) OR
        (r.space_id=? AND r.layer_id IN (SELECT value FROM json_each(?))
         AND r.record_id IN (SELECT record_id FROM record_bounds
           WHERE min_x<=? AND max_x>=? AND min_y<=? AND max_y>=?)))) ,
    selected(id) AS (
      SELECT id FROM roots
      UNION SELECT l.target FROM selected s
        CROSS JOIN records_core r ON r.world_id=? AND r.id=s.id
        CROSS JOIN record_links l ON l.source=r.record_id AND l.relation IN (SELECT value FROM json_each(?))
      UNION SELECT r.id FROM selected s
        CROSS JOIN record_links l ON l.world_id=? AND l.target=s.id AND l.relation IN (SELECT value FROM json_each(?))
        CROSS JOIN records_core r ON r.record_id=l.source WHERE ?)
    SELECT r.id FROM records_core r JOIN selected s ON s.id=r.id
    WHERE r.world_id=? AND r.kind='feature' AND (? IS NULL OR r.id>?) ORDER BY r.id LIMIT ?`,
      [
        input.scope.worldId,
        Number(independent),
        input.scope.areaId,
        JSON.stringify(input.featureIds),
        input.scope.spaceId,
        JSON.stringify(input.layers),
        b[2],
        b[0],
        b[3],
        b[1],
        input.scope.worldId,
        JSON.stringify(relations),
        input.scope.worldId,
        JSON.stringify(relations),
        Number(input.dependencies),
        input.scope.worldId,
        after,
        after,
        limit,
      ]
    )
    .map(String);
}
