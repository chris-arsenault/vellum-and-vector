import { requireThat, type SpatialScope } from "@atlas/domain";
import { integer, type Sql } from "./database";
import { readNodes, readReaches, readConnections } from "./networkRows";
import type { PageRequest } from "./spatialRows";

const selections = {
  node: {
    source: "atlas_nodes n",
    id: "n.id",
    predicate:
      "COALESCE(n.space_id,n.scope_id)=$2 AND ST_Intersects(ST_SetSRID(ST_MakePoint((n.point).x,(n.point).y),0),ST_SetSRID(ST_GeomFromGeoJSON($4::text),0))",
  },
  reach: {
    source:
      "atlas_reaches n JOIN atlas_nodes a ON a.scope_id=n.scope_id AND a.id=n.start_id AND a.valid_from<=$3 AND (a.valid_to IS NULL OR a.valid_to>$3)",
    id: "n.id",
    predicate:
      "COALESCE(a.space_id,a.scope_id)=$2 AND ST_Intersects(n.geometry,ST_SetSRID(ST_GeomFromGeoJSON($4::text),0))",
  },
  connection: {
    source:
      "atlas_connections n JOIN atlas_areas a ON a.scope_id=n.scope_id AND a.id=n.a_area AND a.valid_from<=$3 AND (a.valid_to IS NULL OR a.valid_to>$3) JOIN atlas_areas b ON b.scope_id=n.scope_id AND b.id=n.b_area AND b.valid_from<=$3 AND (b.valid_to IS NULL OR b.valid_to>$3)",
    id: "n.id",
    predicate:
      "((a.space_id=$2 AND ST_Intersects(ST_SetSRID(ST_MakePoint((n.a_point).x,(n.a_point).y),0),ST_SetSRID(ST_GeomFromGeoJSON($4::text),0))) OR (b.space_id=$2 AND ST_Intersects(ST_SetSRID(ST_MakePoint((n.b_point).x,(n.b_point).y),0),ST_SetSRID(ST_GeomFromGeoJSON($4::text),0))))",
  },
};
export async function queryNetworkPage(
  sql: Sql,
  scope: SpatialScope,
  kind: keyof typeof selections,
  page: PageRequest
) {
  requireThat(
    Number.isSafeInteger(page.offset) &&
      page.offset >= 0 &&
      Number.isSafeInteger(page.limit) &&
      page.limit > 0,
    "invalid_page",
    "Network queries require a valid page."
  );
  const selection = selections[kind],
    parameters = [scope.worldId, scope.spaceId, scope.revision, JSON.stringify(scope.footprint)];
  const predicate = `n.scope_id=$1 AND n.valid_from<=$3 AND (n.valid_to IS NULL OR n.valid_to>$3) AND (${selection.predicate})`;
  const rows = await sql.query<{ id: string }>(
    `SELECT ${selection.id} AS id FROM ${selection.source} WHERE ${predicate} ORDER BY n.id OFFSET $5 LIMIT $6`,
    [...parameters, page.offset, page.limit]
  );
  const counts = await sql.query<{ total: string }>(
    `SELECT count(*) AS total FROM ${selection.source} WHERE ${predicate}`,
    parameters
  );
  const ids = rows.rows.map((r) => r.id),
    total = integer(counts.rows[0].total);
  const selected =
    kind === "node"
      ? await readNodes(sql, scope.worldId, scope.revision, ids)
      : kind === "reach"
        ? await readReaches(sql, scope.worldId, scope.revision, ids)
        : await readConnections(sql, scope.worldId, scope.revision, ids);
  return {
    items: ids.map((id) => selected.objects[id]),
    total,
    nextOffset: page.offset + ids.length < total ? page.offset + ids.length : null,
  };
}
