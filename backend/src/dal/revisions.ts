import { randomUUID } from "node:crypto";
import type { ObjectKind, RevisionReference } from "@atlas/domain";
import { integer, insertRows, sqlIdentifier, type Sql } from "./database";

export const revisionTables: Record<ObjectKind, string> = {
  area: "atlas_areas",
  feature: "atlas_features",
  entity: "atlas_entities",
  layer: "atlas_layers",
  connection: "atlas_connections",
  field: "atlas_field_references",
  node: "atlas_nodes",
  reach: "atlas_reaches",
  representation: "atlas_representations",
  coverage: "atlas_materialized_coverage",
  fieldPatch: "atlas_field_patches",
  magic: "atlas_magic",
  view: "atlas_views",
};

export async function currentRevisions(
  sql: Sql,
  scope: string,
  kind: ObjectKind,
  ids: string[]
): Promise<RevisionReference[]> {
  if (ids.length === 0) return [];
  const result = await sql.query<{ id: string; revision_id: string; valid_from: string }>(
    `SELECT id,revision_id,valid_from FROM ${sqlIdentifier(revisionTables[kind])} WHERE scope_id=$1 AND valid_to IS NULL
      AND id=ANY($2::${kind === "layer" ? "text" : "uuid"}[])`,
    [scope, ids]
  );
  return result.rows.map((row) => ({
    kind,
    id: row.id,
    revisionId: row.revision_id,
    version: integer(row.valid_from),
  }));
}

export async function closeRevisions(
  sql: Sql,
  scope: string,
  version: number,
  kind: ObjectKind,
  ids: string[]
): Promise<void> {
  if (ids.length === 0) return;
  await sql.query(
    `UPDATE ${sqlIdentifier(revisionTables[kind])} SET valid_to=$1 WHERE scope_id=$2 AND valid_to IS NULL
    AND id=ANY($3::${kind === "layer" ? "text" : "uuid"}[])`,
    [version, scope, ids]
  );
}

export async function allocateRevisions(
  sql: Sql,
  scope: string,
  ids: string[]
): Promise<Map<string, string>> {
  const pairs = ids.map((id) => [id, randomUUID()] as const);
  await insertRows(
    sql,
    "atlas_revision_owners",
    ["id", "scope_id"],
    pairs.map((pair) => [pair[1], scope])
  );
  return new Map(pairs);
}
