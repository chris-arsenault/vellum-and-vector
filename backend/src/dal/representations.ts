import {
  representationId,
  requireThat,
  geometrySchema,
  type LocatedRepresentation,
  type SpatialScope,
  materializationStates as states,
} from "@atlas/domain";
import { insertRows, registerObjects, type Sql } from "./database";
import { writeAttributes } from "./attributes";
import { currentRevisions } from "./revisions";
import type { Revised } from "./objectWriters";

export interface RepresentationKey {
  featureId: string;
  areaId: string;
}
export type RepresentationScope = Pick<SpatialScope, "spaceId" | "footprint"> & {
  ids?: string[];
  completeFeatures?: string[];
};
export interface RepresentationRow {
  revision_id: string;
  id: string;
  feature_id: string;
  valid_from: string;
  area_id: string;
  geometry: string;
  state: number;
  actor: string;
  generation_id: string | null;
  protected: boolean;
  needs_reconciliation: boolean;
  has_attributes: boolean;
}

export async function readRepresentationRows(
  sql: Sql,
  scope: string,
  version: number,
  features: string[],
  selection: RepresentationScope | null
): Promise<RepresentationRow[]> {
  if (features.length === 0) return [];
  const result = await sql.query<RepresentationRow>(
    `SELECT r.revision_id,r.id,r.feature_id,r.valid_from,r.area_id,ST_AsGeoJSON(r.geometry,15) AS geometry,
    r.state,r.actor,r.generation_id,r.protected,r.needs_reconciliation,r.has_attributes FROM atlas_representations r
    JOIN atlas_areas a ON a.scope_id=r.scope_id AND a.id=r.area_id AND a.valid_from<=$2 AND (a.valid_to IS NULL OR a.valid_to>$2)
    WHERE r.scope_id=$1 AND r.valid_from<=$2 AND (r.valid_to IS NULL OR r.valid_to>$2) AND r.feature_id=ANY($3::uuid[])
      AND (r.id=ANY($6::uuid[]) OR r.feature_id=ANY($7::uuid[]) OR (($4::uuid IS NULL OR a.space_id=$4) AND ($5::text IS NULL OR ST_Intersects(a.footprint,ST_SetSRID(ST_GeomFromGeoJSON($5::text),0))))) ORDER BY r.area_id`,
    [
      scope,
      version,
      features,
      selection?.spaceId ?? null,
      selection ? JSON.stringify(selection.footprint) : null,
      selection?.ids ?? [],
      selection?.completeFeatures ?? [],
    ]
  );
  return result.rows;
}
export const representationKey = (key: RepresentationKey): string =>
  JSON.stringify([key.featureId, key.areaId]);

export async function representationIdentities(
  sql: Sql,
  scope: string,
  keys: RepresentationKey[]
): Promise<Map<string, string>> {
  if (keys.length === 0) return new Map();
  const result = await sql.query<{ id: string; feature_id: string; area_id: string }>(
    `SELECT i.id,i.feature_id,i.area_id FROM atlas_representation_ids i JOIN unnest($2::uuid[],$3::uuid[]) AS p(feature,area)
      ON i.feature_id=p.feature AND i.area_id=p.area WHERE i.scope_id=$1`,
    [scope, keys.map((k) => k.featureId), keys.map((k) => k.areaId)]
  );
  const existing = new Map(
    result.rows.map((row) => [
      representationKey({ featureId: row.feature_id, areaId: row.area_id }),
      row.id,
    ])
  );
  return new Map(
    keys.map((key) => [
      representationKey(key),
      existing.get(representationKey(key)) ?? representationId(scope, key.featureId, key.areaId),
    ])
  );
}

const columns = [
  "revision_id",
  "feature_revision",
  "area_id",
  "geometry",
  "state",
  "actor",
  "generation_id",
  "protected",
  "needs_reconciliation",
  "has_attributes",
  "scope_id",
  "id",
  "feature_id",
  "valid_from",
];

async function registerRepresentationIdentities(
  sql: Sql,
  scope: string,
  values: Revised<LocatedRepresentation>[]
): Promise<void> {
  const identities = await representationIdentities(
    sql,
    scope,
    values.map((row) => row.value)
  );
  for (const { value } of values)
    requireThat(
      identities.get(representationKey(value)) === value.id,
      "representation_identity_conflict",
      "A representation retains its existing feature/area identity."
    );
  await registerObjects(
    sql,
    scope,
    values.map(({ value }) => ({ id: value.id, kind: "representation" }))
  );
  await sql.query(
    `INSERT INTO atlas_representation_ids(scope_id,feature_id,area_id,id)
    SELECT $1,p.feature,p.area,p.id FROM unnest($2::uuid[],$3::uuid[],$4::uuid[]) AS p(feature,area,id)
    ON CONFLICT(scope_id,feature_id,area_id) DO NOTHING`,
    [
      scope,
      values.map((row) => row.value.featureId),
      values.map((row) => row.value.areaId),
      values.map((row) => row.value.id),
    ]
  );
}

export async function writeRepresentations(
  sql: Sql,
  scope: string,
  version: number,
  values: Revised<LocatedRepresentation>[]
): Promise<void> {
  if (values.length === 0) return;
  await registerRepresentationIdentities(sql, scope, values);
  const bases = new Map(
    (
      await currentRevisions(
        sql,
        scope,
        "feature",
        values.map((row) => row.value.featureId)
      )
    ).map((row) => [row.id, row.revisionId])
  );
  requireThat(
    values.every((row) => bases.has(row.value.featureId)),
    "missing_feature",
    "A representation requires an existing semantic feature."
  );
  await insertRows(
    sql,
    "atlas_representations",
    columns,
    values.map(({ revision, value: v }) => [
      revision,
      bases.get(v.featureId),
      v.areaId,
      JSON.stringify(geometrySchema.parse(v.geometry)),
      states.indexOf(v.state),
      v.actor,
      v.generationId,
      v.protected,
      v.needsReconciliation,
      v.attributes !== null,
      scope,
      v.id,
      v.featureId,
      version,
    ]),
    ["geometry"]
  );
  await writeAttributes(
    sql,
    values
      .filter((row) => row.value.attributes !== null)
      .map(({ revision, value }) => ({
        revision,
        attributes: value.attributes!,
        geometry: value.geometry,
      }))
  );
}
