import type { ReadRequirements, RevisionReference, ObjectKind } from "@atlas/domain";
import { asRevision, type Sql } from "./database";
import { revisionTables } from "./revisions";

export async function constraintAreaIds(sql: Sql, input: ReadRequirements): Promise<string[]> {
  const c = input.constraints;
  if (!c) return [];
  const s = input.scope;
  const rows = await sql.query<{ id: string }>(
    `WITH RECURSIVE descendants(id) AS (
    SELECT unnest($4::uuid[]) UNION SELECT a.id FROM atlas_areas a JOIN descendants d ON a.parent_id=d.id
      WHERE a.scope_id=$1 AND a.valid_from<=$2 AND (a.valid_to IS NULL OR a.valid_to>$2))
    SELECT id FROM descendants UNION SELECT a.id FROM atlas_areas a WHERE a.scope_id=$1 AND a.valid_from<=$2 AND (a.valid_to IS NULL OR a.valid_to>$2)
      AND ST_Intersects(a.footprint,ST_SetSRID(ST_GeomFromGeoJSON($3::text),0)) AND
      (($5 AND a.space_id=$6) OR EXISTS(SELECT FROM atlas_boundary_crossings b WHERE b.revision_id=a.revision_id AND b.feature_id=ANY($7::uuid[])))`,
    [
      s.worldId,
      s.revision,
      JSON.stringify(s.footprint),
      c.descendantsOf,
      c.intersectingAreas,
      s.spaceId,
      c.boundaryFeatures,
    ]
  );
  return rows.rows.map((r) => r.id);
}
export async function readReferenceRevisions(
  sql: Sql,
  input: ReadRequirements
): Promise<RevisionReference[]> {
  const ids = input.references ?? [];
  if (!ids.length) return [];
  const result: RevisionReference[] = [],
    s = input.scope;
  for (const [key, table] of Object.entries(revisionTables).filter(([kind]) => kind !== "layer")) {
    const kind = key as ObjectKind;
    const rows = await sql.query<{ id: string; revision_id: string; valid_from: string }>(
      `SELECT id,revision_id,valid_from FROM ${table} WHERE scope_id=$1 AND valid_from<=$2 AND (valid_to IS NULL OR valid_to>$2) AND id=ANY($3::uuid[])`,
      [s.worldId, s.revision, ids]
    );
    result.push(...rows.rows.map((r) => asRevision(kind, r)));
  }
  return result;
}
export async function layerContentIds(sql: Sql, input: ReadRequirements): Promise<string[]> {
  if (!input.layerContents?.length) return [];
  const s = input.scope;
  const rows = await sql.query<{ id: string }>(
    "SELECT id FROM atlas_features WHERE scope_id=$1 AND valid_from<=$2 AND (valid_to IS NULL OR valid_to>$2) AND layer_id=ANY($3::text[])",
    [s.worldId, s.revision, input.layerContents]
  );
  return rows.rows.map((r) => r.id);
}
export async function layerAreaIds(sql: Sql, input: ReadRequirements): Promise<string[]> {
  const layers = input.layerContents ?? [];
  if (!layers.length) return [];
  const s = input.scope;
  const result = await sql.query<{ id: string }>(
    `SELECT area_id AS id FROM atlas_field_references WHERE scope_id=$1 AND valid_from<=$2 AND (valid_to IS NULL OR valid_to>$2) AND layer_id=ANY($3::text[])
    UNION SELECT a.id FROM atlas_areas a JOIN atlas_area_layers l ON l.revision_id=a.revision_id WHERE a.scope_id=$1 AND a.valid_from<=$2 AND (a.valid_to IS NULL OR a.valid_to>$2) AND l.layer_id=ANY($3::text[])`,
    [s.worldId, s.revision, layers]
  );
  return result.rows.map((r) => r.id);
}
export async function identityKinds(
  sql: Sql,
  input: ReadRequirements
): Promise<Record<string, string>> {
  const ids = [
    ...input.objects.filter((o) => o.kind !== "layer").flatMap((o) => o.ids),
    ...(input.references ?? []),
  ];
  if (!ids.length) return {};
  const rows = await sql.query<{ id: string; kind: string }>(
    "SELECT id,kind FROM atlas_objects WHERE scope_id=$1 AND id=ANY($2::uuid[])",
    [input.scope.worldId, ids]
  );
  return Object.fromEntries(rows.rows.map((r) => [r.id, r.kind]));
}
