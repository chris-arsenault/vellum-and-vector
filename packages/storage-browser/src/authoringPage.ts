import type { Database } from "@sqlite.org/sqlite-wasm";
import {
  requireThat,
  type AuthoringFeatureQuery,
  type NetworkNode,
  type WorkspaceScope,
} from "@atlas/domain";
import type { GeometryKernel } from "./geometryKernel";
import { RecordSelection } from "./recordSelection";

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
  const independent = db.selectValue(
    "SELECT json_type(data,'$.value.map') IS NOT NULL OR json_extract(data,'$.value.parentId') IS NULL FROM records_core WHERE world_id=? AND kind='area' AND id=?",
    [input.scope.worldId, input.scope.areaId]
  );
  if (independent) {
    const complete = completeMapIds(db, input, after, limit);
    if (complete) return complete;
  }
  const b = kernel.encode(input.scope.footprint, precision).bounds;
  // A map's starting footprint does not limit which of its own records generation reads.
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
         AND (?=1 OR r.record_id IN (SELECT record_id FROM record_bounds
           WHERE min_x<=? AND max_x>=? AND min_y<=? AND max_y>=?))))) ,
    selected(id) AS (
      SELECT id FROM roots
      UNION SELECT l.target FROM selected s
        CROSS JOIN records_core r ON r.world_id=? AND r.id=s.id
        CROSS JOIN record_links l ON l.source=r.record_id AND l.relation IN (SELECT value FROM json_each(?))
      UNION SELECT r.id FROM selected s
        CROSS JOIN record_links l ON l.world_id=? AND l.target=s.id AND l.relation IN (SELECT value FROM json_each(?))
        CROSS JOIN records_core r ON r.record_id=l.source WHERE ?)
    SELECT r.id FROM records_core r JOIN selected s ON s.id=r.id
    WHERE r.world_id=? AND r.kind='feature' AND (?=0 OR r.area_id=?)
    AND (? IS NULL OR r.id>?) ORDER BY r.id LIMIT ?`,
      [
        input.scope.worldId,
        Number(independent),
        input.scope.areaId,
        JSON.stringify(input.featureIds),
        input.scope.spaceId,
        JSON.stringify(input.layers),
        Number(independent),
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
        Number(independent),
        input.scope.areaId,
        after,
        after,
        limit,
      ]
    )
    .map(String);
}

/** If every owned feature is already a root, dependency closure cannot add another
 * owned feature. Page the existing scope index instead of rebuilding that graph per page. */
function completeMapIds(
  db: Database,
  input: AuthoringFeatureQuery,
  after: string | null,
  limit: number
) {
  const { worldId, spaceId, areaId } = input.scope;
  const omitted = db.selectValue(
    `SELECT EXISTS(SELECT 1 FROM records_core WHERE world_id=? AND kind='feature'
      AND layer_id NOT IN (SELECT value FROM json_each(?)))
    OR EXISTS(SELECT 1 FROM records_core WHERE world_id=? AND area_id=? AND kind='feature' AND space_id<>?)`,
    [worldId, JSON.stringify(input.layers), worldId, areaId, spaceId]
  );
  if (omitted) return null;
  return db
    .selectValues(
      `SELECT id FROM records_core WHERE world_id=? AND space_id=? AND area_id=? AND kind='feature'
    ${after === null ? "" : "AND id>?"} ORDER BY id LIMIT ?`,
      [worldId, spaceId, areaId, ...(after === null ? [] : [after]), limit]
    )
    .map(String);
}

export function unconnectedNodeSelection(
  db: Database,
  kernel: GeometryKernel,
  scope: WorkspaceScope,
  loaded: Record<string, NetworkNode> = {}
) {
  const selection = new RecordSelection(scope.worldId, db, kernel);
  selection.select(
    `r.space_id=? AND r.area_id=? AND r.kind='node' AND NOT EXISTS
    (SELECT 1 FROM record_links l WHERE l.world_id=r.world_id AND l.target=r.id AND l.relation='node')`,
    [scope.spaceId, scope.areaId]
  );
  for (const [key, record] of selection.records)
    if (loaded[record.reference.id]) selection.records.delete(key);
  return selection;
}
