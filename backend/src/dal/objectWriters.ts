import {
  profiles,
  geometrySchema,
  type AtlasFeature,
  type Connection,
  type Entity,
  type Layer,
} from "@atlas/domain";
import { insertRows, type Sql } from "./database";
import { states } from "./objectReaders";
import { writeAttributes, type AttributeRecord } from "./attributes";

export interface Revised<T> {
  revision: string;
  value: T;
}

const featureColumns = [
  "revision_id",
  "scope_id",
  "id",
  "valid_from",
  "name",
  "kind",
  "layer_id",
  "area_id",
  "geometry",
  "state",
  "protected",
  "actor",
  "generation_id",
  "generation_domain",
  "causes",
];

function featureRow(scope: string, version: number, revision: string, v: AtlasFeature): unknown[] {
  return [
    revision,
    scope,
    v.id,
    version,
    v.name,
    v.kind,
    v.layerId,
    v.areaId,
    JSON.stringify(geometrySchema.parse(v.geometry)),
    states.indexOf(v.state),
    v.protected,
    v.actor,
    v.generationId,
    v.generationDomain ?? null,
    v.causes,
  ];
}

export async function writeFeatureBases(
  sql: Sql,
  scope: string,
  version: number,
  features: Revised<AtlasFeature>[]
): Promise<void> {
  await insertRows(
    sql,
    "atlas_features",
    featureColumns,
    features.map(({ revision, value }) => featureRow(scope, version, revision, value)),
    ["geometry"]
  );
  const attributes: AttributeRecord[] = features.map(({ revision, value }) => ({
    revision,
    attributes: value.attributes,
    geometry: value.geometry,
  }));
  await writeAttributes(sql, attributes);
  await insertRows(
    sql,
    "atlas_relations",
    ["revision_id", "ordinal", "scope_id", "target_id", "kind"],
    features.flatMap(({ revision, value }) =>
      value.relations.map((relation, i) => [revision, i, scope, relation.targetId, relation.kind])
    )
  );
}

export async function writeEntities(
  sql: Sql,
  scope: string,
  version: number,
  entities: Revised<Entity>[]
): Promise<void> {
  await insertRows(
    sql,
    "atlas_entities",
    ["revision_id", "scope_id", "id", "valid_from", "name", "kind", "state"],
    entities.map(({ revision, value }) => [
      revision,
      scope,
      value.id,
      version,
      value.name,
      value.kind,
      states.indexOf(value.state ?? "authored"),
    ])
  );
  await writeAttributes(
    sql,
    entities.map(({ revision, value }) => ({
      revision,
      attributes: value.attributes,
      geometry: null,
    }))
  );
  await insertRows(
    sql,
    "atlas_relations",
    ["revision_id", "ordinal", "scope_id", "target_id", "kind"],
    entities.flatMap(({ revision, value }) =>
      (value.relations ?? []).map((relation, i) => [
        revision,
        i,
        scope,
        relation.targetId,
        relation.kind,
      ])
    )
  );
}

export async function writeLayers(
  sql: Sql,
  scope: string,
  version: number,
  layers: Revised<Layer>[]
): Promise<void> {
  if (layers.length === 0) return;
  await sql.query(
    "INSERT INTO atlas_layer_ids(scope_id,id) SELECT $1,unnest($2::text[]) ON CONFLICT DO NOTHING",
    [scope, layers.map((l) => l.value.id)]
  );
  await insertRows(
    sql,
    "atlas_layers",
    [
      "revision_id",
      "scope_id",
      "id",
      "valid_from",
      "name",
      "family",
      "representation",
      "color",
      "profiles",
      "generator",
      "representations",
      "facts",
    ],
    layers.map(({ revision, value }) => [
      revision,
      scope,
      value.id,
      version,
      value.name,
      value.family,
      value.representation,
      value.color,
      value.profiles.map((profile) => profiles.indexOf(profile)),
      value.generator,
      value.representations ?? null,
      value.facts ?? null,
    ])
  );
  await writeAttributes(
    sql,
    layers.map(({ revision, value }) => ({ revision, attributes: value.schema, geometry: null }))
  );
}

export async function writeConnections(
  sql: Sql,
  scope: string,
  version: number,
  connections: Revised<Connection>[]
): Promise<void> {
  if (connections.length === 0) return;
  const values = connections.map(({ revision, value }) => ({ revision, ...value }));
  await sql.query(
    `INSERT INTO atlas_connections(revision_id,scope_id,id,valid_from,kind,a_area,a_point,a_feature,b_area,b_point,b_feature,flow,a_node,b_node)
    SELECT c.revision,$1,c.id,$2,c.kind,c.a_area,ROW(c.ax,c.ay,c.az)::atlas_position,c.a_feature,
      c.b_area,ROW(c.bx,c.by,c.bz)::atlas_position,c.b_feature,c.flow,c.a_node,c.b_node
      FROM unnest($3::uuid[],$4::uuid[],$5::text[],$6::uuid[],$7::float8[],$8::float8[],$9::float8[],$10::uuid[],
        $11::uuid[],$12::float8[],$13::float8[],$14::float8[],$15::uuid[],$16::float8[],$17::uuid[],$18::uuid[])
      AS c(revision,id,kind,a_area,ax,ay,az,a_feature,b_area,bx,by,bz,b_feature,flow,a_node,b_node)`,
    [
      scope,
      version,
      values.map((v) => v.revision),
      values.map((v) => v.id),
      values.map((v) => v.kind),
      values.map((v) => v.a.areaId),
      values.map((v) => v.a.position.x),
      values.map((v) => v.a.position.y),
      values.map((v) => v.a.position.z),
      values.map((v) => v.a.featureId),
      values.map((v) => v.b.areaId),
      values.map((v) => v.b.position.x),
      values.map((v) => v.b.position.y),
      values.map((v) => v.b.position.z),
      values.map((v) => v.b.featureId),
      values.map((v) => v.flow),
      values.map((v) => v.a.nodeId ?? null),
      values.map((v) => v.b.nodeId ?? null),
    ]
  );
}
