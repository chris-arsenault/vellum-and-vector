import type { ReadRequirements, ObjectKind } from "@atlas/domain";
import type { Sql } from "./database";

export function selectedIds(input: ReadRequirements, kind: ObjectKind): string[] {
  return [...new Set(input.objects.filter((o) => o.kind === kind).flatMap((o) => o.ids))];
}
export async function spatialFeatureIds(sql: Sql, input: ReadRequirements): Promise<string[]> {
  if (input.spatialLayers.length === 0) return [];
  const s = input.scope;
  const result = await sql.query<{ feature_id: string }>(
    `SELECT feature_id FROM atlas_spatial_revisions WHERE scope_id=$1 AND space_id=$2
    AND valid_from<=$3 AND (valid_to IS NULL OR valid_to>$3) AND layer_id=ANY($4::text[])
    AND ST_Intersects(geometry,ST_SetSRID(ST_GeomFromGeoJSON($5::text),0)) ORDER BY feature_id`,
    [s.worldId, s.spaceId, s.revision, input.spatialLayers, JSON.stringify(s.footprint)]
  );
  return result.rows.map((r) => r.feature_id);
}
export async function dependentIds(
  sql: Sql,
  world: string,
  version: number,
  ids: string[]
): Promise<string[]> {
  if (ids.length === 0) return [];
  const result = await sql.query<{ id: string }>(
    `WITH RECURSIVE deps(id) AS (
    SELECT unnest($3::uuid[]) UNION
      SELECT f.id FROM atlas_relations r JOIN atlas_features f ON f.scope_id=r.scope_id AND f.revision_id=r.revision_id
        JOIN deps d ON r.target_id=d.id
        WHERE r.scope_id=$1 AND f.valid_from<=$2 AND (f.valid_to IS NULL OR f.valid_to>$2) AND r.kind IN ('follows','boundedBy','dependsOn')) SELECT id FROM deps`,
    [world, version, ids]
  );
  return result.rows.map((r) => r.id);
}

export async function adjacentNetworkFeatures(
  sql: Sql,
  world: string,
  version: number,
  ids: string[]
): Promise<string[]> {
  if (ids.length === 0) return [];
  const result = await sql.query<{ id: string | null }>(
    `SELECT b.feature_id AS id FROM atlas_reaches a JOIN atlas_reaches b ON b.scope_id=a.scope_id
    AND (b.start_id IN (a.start_id,a.end_id) OR b.end_id IN (a.start_id,a.end_id))
    WHERE a.scope_id=$1 AND a.feature_id=ANY($3::uuid[]) AND a.valid_from<=$2 AND (a.valid_to IS NULL OR a.valid_to>$2)
      AND b.valid_from<=$2 AND (b.valid_to IS NULL OR b.valid_to>$2)
    UNION SELECT unnest(ARRAY[a_feature,b_feature]) FROM atlas_connections WHERE scope_id=$1 AND valid_from<=$2 AND (valid_to IS NULL OR valid_to>$2)
      AND (a_feature=ANY($3::uuid[]) OR b_feature=ANY($3::uuid[]))`,
    [world, version, ids]
  );
  return result.rows.flatMap((r) => (r.id ? [r.id] : []));
}

export async function bindingSourceIds(
  sql: Sql,
  world: string,
  version: number,
  ids: string[]
): Promise<string[]> {
  if (ids.length === 0) return [];
  const result = await sql.query<{ id: string }>(
    `WITH RECURSIVE sources(id) AS (SELECT unnest($3::uuid[]) UNION
    SELECT r.target_id FROM sources s JOIN atlas_features f ON f.scope_id=$1 AND f.id=s.id
      AND f.valid_from<=$2 AND (f.valid_to IS NULL OR f.valid_to>$2)
    JOIN atlas_relations r ON r.scope_id=f.scope_id AND r.revision_id=f.revision_id AND r.kind='follows') SELECT id FROM sources`,
    [world, version, ids]
  );
  return result.rows.map((r) => r.id);
}
export async function featureAreaIds(
  sql: Sql,
  world: string,
  version: number,
  ids: string[]
): Promise<string[]> {
  if (ids.length === 0) return [];
  const result = await sql.query<{ id: string }>(
    `SELECT area_id AS id FROM atlas_features WHERE scope_id=$1 AND id=ANY($3::uuid[]) AND valid_from<=$2 AND (valid_to IS NULL OR valid_to>$2)
    UNION SELECT area_id FROM atlas_representations WHERE scope_id=$1 AND feature_id=ANY($3::uuid[]) AND valid_from<=$2 AND (valid_to IS NULL OR valid_to>$2)`,
    [world, version, ids]
  );
  return result.rows.map((r) => r.id);
}
