import type { ReadRequirements } from "@atlas/domain";
import type { Sql } from "./database";
import { selectedIds } from "./selection";
import { readConnections, readNodes, readReaches } from "./networkRows";

export async function readSelectedNetwork(sql: Sql, input: ReadRequirements, features: string[]) {
  const s = input.scope,
    ids = input.dependencies ? features : [];
  const reachRows = await sql.query<{ id: string; start_id: string; end_id: string }>(
    `SELECT id,start_id,end_id FROM atlas_reaches
    WHERE scope_id=$1 AND valid_from<=$2 AND (valid_to IS NULL OR valid_to>$2) AND (feature_id=ANY($3::uuid[]) OR id=ANY($4::uuid[]))`,
    [s.worldId, s.revision, ids, selectedIds(input, "reach")]
  );
  const anchors = [
    ...selectedIds(input, "node"),
    ...reachRows.rows.flatMap((r) => [r.start_id, r.end_id]),
  ];
  const connectionRows = await sql.query<{
    id: string;
    a_node: string | null;
    b_node: string | null;
  }>(
    `SELECT id,a_node,b_node FROM atlas_connections WHERE scope_id=$1 AND valid_from<=$2 AND (valid_to IS NULL OR valid_to>$2)
    AND (a_feature=ANY($3::uuid[]) OR b_feature=ANY($3::uuid[]) OR id=ANY($4::uuid[]) OR a_node=ANY($5::uuid[]) OR b_node=ANY($5::uuid[]))`,
    [s.worldId, s.revision, ids, selectedIds(input, "connection"), anchors]
  );
  const nodes = await readNodes(sql, s.worldId, s.revision, [
    ...new Set([
      ...selectedIds(input, "node"),
      ...reachRows.rows.flatMap((r) => [r.start_id, r.end_id]),
      ...connectionRows.rows.flatMap((c) =>
        [c.a_node, c.b_node].filter((id): id is string => id !== null)
      ),
    ]),
  ]);
  const reaches = await readReaches(
    sql,
    s.worldId,
    s.revision,
    reachRows.rows.map((r) => r.id)
  );
  const connections = await readConnections(
    sql,
    s.worldId,
    s.revision,
    connectionRows.rows.map((r) => r.id)
  );
  return { nodes, reaches, connections };
}
