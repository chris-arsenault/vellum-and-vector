import {
  frameSchema,
  profiles,
  geometrySchema,
  requireThat,
  type Area,
  type Trait,
} from "@atlas/domain";
import { insertRows, type Sql } from "./database";
import { states } from "./objectReaders";
import { writeBoundary } from "./boundaryWriter";

async function traits(sql: Sql, revision: string, source: string, values: Trait[]): Promise<void> {
  await insertRows(
    sql,
    "atlas_area_traits",
    [
      "revision_id",
      "source",
      "ordinal",
      "field",
      "kind",
      "minimum",
      "maximum",
      "cause",
      "footprint",
    ],
    values.map((trait, i) => [
      revision,
      source,
      i,
      trait.field,
      trait.kind,
      trait.minimum,
      trait.maximum,
      trait.cause,
      trait.scope ? JSON.stringify(geometrySchema.parse(trait.scope)) : null,
    ]),
    ["footprint"]
  );
}

async function locatedSpace(sql: Sql, scope: string, version: number, area: Area): Promise<string> {
  if (area.profile === "interior" || area.context === "cave" || area.frame.floor !== null)
    return area.id;
  if (area.parentId === null) return scope;
  const result = await sql.query<{ space_id: string }>(
    "SELECT space_id FROM atlas_areas WHERE scope_id=$1 AND id=$2 AND valid_from<=$3 AND (valid_to IS NULL OR valid_to>$3)",
    [scope, area.parentId, version]
  );
  requireThat(
    result.rowCount === 1,
    "missing_parent",
    "A located area requires a persisted geographic parent."
  );
  return result.rows[0].space_id;
}

export async function writeArea(
  sql: Sql,
  scope: string,
  version: number,
  revision: string,
  area: Area
): Promise<void> {
  const frame = frameSchema.parse(area.frame);
  const space = await locatedSpace(sql, scope, version, area);
  requireThat(
    area.spaceId === undefined || area.spaceId === space,
    "space_mismatch",
    "Area space must resolve through its located parent."
  );
  await sql.query(
    `INSERT INTO atlas_areas(revision_id,scope_id,id,valid_from,parent_id,name,profile,footprint,frame,boundary,
    traits,local_traits,version,template_id,context,context_feature_id,template_instance_id,recipe,recipe_job_id,local_traits_defined,space_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,ST_SetSRID(ST_GeomFromGeoJSON($8::text),0),
    ROW(ROW($9,$10,$11)::atlas_position,$12,$13,$14)::atlas_frame,NULL,'{}',CASE WHEN $21 THEN '{}'::atlas_trait[] ELSE NULL END,
    $15,$16,$17,$18,$19,NULL,$20,$21,$22)`,
    [
      revision,
      scope,
      area.id,
      version,
      area.parentId,
      area.name,
      profiles.indexOf(area.profile),
      JSON.stringify(geometrySchema.parse(area.footprint)),
      frame.origin.x,
      frame.origin.y,
      frame.origin.z,
      frame.rotation,
      frame.metresPerUnit,
      frame.floor,
      area.version,
      area.templateId,
      area.context,
      area.contextFeatureId ?? null,
      area.templateInstanceId ?? null,
      area.recipeJobId ?? null,
      area.localTraits !== undefined,
      space,
    ]
  );
  await traits(sql, revision, "effective", area.traits);
  await traits(sql, revision, "local", area.localTraits ?? []);
  await insertRows(
    sql,
    "atlas_area_layers",
    ["revision_id", "layer_id", "state"],
    Object.entries(area.layers).map(([id, state]) => [revision, id, states.indexOf(state)])
  );
  if (area.boundary) await writeBoundary(sql, scope, revision, area.boundary);
}
