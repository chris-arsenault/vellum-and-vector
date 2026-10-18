import {
  geometrySchema,
  profiles,
  type Area,
  type FieldSample,
  type RevisionReference,
  type Trait,
} from "@atlas/domain";
import { integer, type Sql } from "./database";
import { states, type ObjectRows } from "./objectReaders";
import { readBoundaries } from "./boundaryRows";

interface AreaRow {
  space_id: string;
  id: string;
  revision_id: string;
  valid_from: string;
  parent_id: string | null;
  name: string;
  profile: number;
  footprint: string;
  frame_x: number;
  frame_y: number;
  frame_z: number;
  rotation: number;
  metres_per_unit: number;
  floor: string | null;
  version: string;
  template_id: string | null;
  context: string;
  context_feature_id: string | null;
  template_instance_id: string | null;
  recipe_job_id: string | null;
  has_local_traits: boolean;
}
const areaColumns = `a.id,a.revision_id,a.valid_from,a.parent_id,a.name,a.profile,a.space_id,ST_AsGeoJSON(a.footprint,15) AS footprint,
  ((a.frame).origin).x AS frame_x,((a.frame).origin).y AS frame_y,((a.frame).origin).z AS frame_z,
  (a.frame).rotation,(a.frame).metres_per_unit,(a.frame).floor,a.version,a.template_id,a.context,a.context_feature_id,
  a.template_instance_id,a.recipe_job_id,a.local_traits_defined AS has_local_traits`;

async function readTraits(
  sql: Sql,
  scope: string,
  revisions: string[],
  local: boolean
): Promise<Map<string, Trait[]>> {
  const source = local ? "local" : "effective";
  const result = await sql.query<{
    revision_id: string;
    field: string;
    kind: string;
    minimum: number;
    maximum: number;
    cause: string | null;
    scope: string | null;
  }>(
    `SELECT t.revision_id,t.field,t.kind,t.minimum,t.maximum,t.cause,ST_AsGeoJSON(t.footprint,15) AS scope
      FROM atlas_area_traits t JOIN atlas_areas a ON a.revision_id=t.revision_id
      WHERE a.scope_id=$1 AND a.revision_id=ANY($2::uuid[]) AND t.source=$3 ORDER BY t.ordinal`,
    [scope, revisions, source]
  );
  const values = new Map(revisions.map((id) => [id, [] as Trait[]]));
  for (const row of result.rows)
    values.get(row.revision_id)!.push({
      field: row.field,
      kind: row.kind,
      minimum: row.minimum,
      maximum: row.maximum,
      cause: row.cause,
      scope: row.scope ? geometrySchema.parse(JSON.parse(row.scope)) : null,
    });
  return values;
}

function areaFromRow(row: AreaRow): Area {
  return {
    spaceId: row.space_id,
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    profile: profiles[row.profile],
    footprint: geometrySchema.parse(JSON.parse(row.footprint)),
    frame: {
      origin: { x: row.frame_x, y: row.frame_y, z: row.frame_z },
      rotation: row.rotation,
      metresPerUnit: row.metres_per_unit,
      floor: row.floor,
    },
    version: integer(row.version),
    traits: [],
    layers: {},
    boundary: null,
    templateId: row.template_id,
    context: row.context,
    contextFeatureId: row.context_feature_id,
    templateInstanceId: row.template_instance_id,
    recipeJobId: row.recipe_job_id,
  };
}

export async function readAreas(
  sql: Sql,
  scope: string,
  version: number,
  ids: string[]
): Promise<ObjectRows<Area>> {
  if (ids.length === 0) return { objects: {}, revisions: [] };
  const result = await sql.query<AreaRow>(
    `SELECT ${areaColumns} FROM atlas_areas a WHERE scope_id=$1 AND valid_from<=$2
    AND (valid_to IS NULL OR valid_to>$2) AND id=ANY($3::uuid[]) ORDER BY id`,
    [scope, version, ids]
  );
  const revisions = result.rows.map((row) => row.revision_id);
  const traits = await readTraits(sql, scope, revisions, false),
    local = await readTraits(sql, scope, revisions, true);
  const objects = Object.create(null) as Record<string, Area>,
    byRevision = new Map<string, Area>();
  for (const row of result.rows) {
    const area = areaFromRow(row);
    area.traits = traits.get(row.revision_id)!;
    if (row.has_local_traits) area.localTraits = local.get(row.revision_id)!;
    objects[row.id] = area;
    byRevision.set(row.revision_id, area);
  }
  const layers = await sql.query<{ revision_id: string; layer_id: string; state: number }>(
    "SELECT * FROM atlas_area_layers WHERE revision_id=ANY($1::uuid[])",
    [revisions]
  );
  for (const row of layers.rows)
    byRevision.get(row.revision_id)!.layers[row.layer_id] = states[row.state];
  await readBoundaries(sql, scope, byRevision);
  return {
    objects,
    revisions: result.rows.map((row): RevisionReference => ({
      kind: "area",
      id: row.id,
      revisionId: row.revision_id,
      version: integer(row.valid_from),
    })),
  };
}

export async function ancestorIds(
  sql: Sql,
  scope: string,
  version: number,
  area: string | string[]
): Promise<string[]> {
  const result = await sql.query<{ id: string }>(
    `WITH RECURSIVE ancestry AS (
    SELECT id,parent_id,ARRAY[id] AS path FROM atlas_areas WHERE scope_id=$1 AND id=ANY($3::uuid[]) AND valid_from<=$2 AND (valid_to IS NULL OR valid_to>$2)
    UNION ALL SELECT p.id,p.parent_id,a.path||p.id FROM atlas_areas p JOIN ancestry a ON p.id=a.parent_id
      WHERE p.scope_id=$1 AND p.valid_from<=$2 AND (p.valid_to IS NULL OR p.valid_to>$2) AND NOT p.id=ANY(a.path)) SELECT DISTINCT id FROM ancestry`,
    [scope, version, typeof area === "string" ? [area] : area]
  );
  return result.rows.map((row) => row.id);
}

export function fieldSample(
  x: number,
  y: number,
  z: number,
  channels: string[],
  values: number[]
): FieldSample {
  return {
    point: { x, y, z },
    values: Object.fromEntries(channels.map((channel, index) => [channel, values[index]])),
  };
}
