import {
  geometrySchema,
  profiles,
  type AtlasFeature,
  type Entity,
  type Layer,
  type Relation,
  type RevisionReference,
  materializationStates,
} from "@atlas/domain";
import { readAttributes } from "./attributes";
import { asRevision, integer, type Sql } from "./database";
import { readRepresentationRows, type RepresentationScope } from "./representations";

export const states = materializationStates;
export interface ObjectRows<T> {
  objects: Record<string, T>;
  revisions: RevisionReference[];
}
interface FeatureRow {
  revision_id: string;
  id: string;
  valid_from: string;
  name: string;
  kind: string;
  layer_id: string;
  area_id: string;
  geometry: string;
  state: number;
  protected: boolean;
  actor: string;
  generation_id: string | null;
  generation_domain: string | null;
  causes: string[];
}

export async function readRelations(
  sql: Sql,
  revisions: string[]
): Promise<Map<string, Relation[]>> {
  const result = await sql.query<{ revision_id: string; target_id: string; kind: string }>(
    "SELECT * FROM atlas_relations WHERE revision_id=ANY($1::uuid[]) ORDER BY ordinal",
    [revisions]
  );
  const groups = new Map(revisions.map((id) => [id, [] as Relation[]]));
  for (const row of result.rows)
    groups.get(row.revision_id)!.push({ targetId: row.target_id, kind: row.kind });
  return groups;
}

export async function readFeatures(
  sql: Sql,
  scope: string,
  version: number,
  ids: string[],
  selection: RepresentationScope | null = null
): Promise<ObjectRows<AtlasFeature>> {
  if (ids.length === 0) return { objects: {}, revisions: [] };
  const rows = await sql.query<FeatureRow>(
    `SELECT revision_id,id,valid_from,name,kind,layer_id,area_id,ST_AsGeoJSON(geometry,15) AS geometry,
    state,protected,actor,generation_id,generation_domain,causes FROM atlas_features WHERE scope_id=$1 AND valid_from<=$2 AND (valid_to IS NULL OR valid_to>$2)
    AND id=ANY($3::uuid[]) ORDER BY id`,
    [scope, version, ids]
  );
  const revisions = rows.rows.map((row) => row.revision_id);
  const details = await readRepresentationRows(
    sql,
    scope,
    version,
    rows.rows.map((row) => row.id),
    selection
  );
  const attributes = await readAttributes(sql, [
    ...revisions,
    ...details.map((row) => row.revision_id),
  ]);
  const relations = await readRelations(sql, revisions),
    objects = Object.create(null) as Record<string, AtlasFeature>;
  for (const row of rows.rows) {
    const feature: AtlasFeature = {
      id: row.id,
      name: row.name,
      kind: row.kind,
      layerId: row.layer_id,
      areaId: row.area_id,
      geometry: geometrySchema.parse(JSON.parse(row.geometry)),
      state: states[row.state],
      protected: row.protected,
      actor: row.actor,
      generationId: row.generation_id,
      generationDomain: row.generation_domain,
      causes: row.causes,
      attributes: attributes.get(row.revision_id)!,
      relations: relations.get(row.revision_id)!,
      detail: Object.create(null) as AtlasFeature["detail"],
    };
    objects[row.id] = feature;
  }
  for (const row of details)
    objects[row.feature_id].detail[row.area_id] = {
      id: row.id,
      geometry: geometrySchema.parse(JSON.parse(row.geometry)),
      state: states[row.state],
      actor: row.actor,
      generationId: row.generation_id,
      protected: row.protected,
      needsReconciliation: row.needs_reconciliation,
      attributes: row.has_attributes ? attributes.get(row.revision_id)! : null,
    };
  return {
    objects,
    revisions: [
      ...rows.rows.map((row) => asRevision("feature", row)),
      ...details.map((row) => asRevision("representation", row)),
    ],
  };
}

export async function readEntities(
  sql: Sql,
  scope: string,
  version: number,
  ids: string[]
): Promise<ObjectRows<Entity>> {
  if (ids.length === 0) return { objects: {}, revisions: [] };
  const rows = await sql.query<{
    revision_id: string;
    id: string;
    valid_from: string;
    name: string;
    kind: string;
    state: number;
  }>(
    `SELECT * FROM atlas_entities WHERE scope_id=$1 AND valid_from<=$2 AND (valid_to IS NULL OR valid_to>$2) AND id=ANY($3::uuid[]) ORDER BY id`,
    [scope, version, ids]
  );
  const revisions = rows.rows.map((row) => row.revision_id),
    attributes = await readAttributes(sql, revisions),
    relations = await readRelations(sql, revisions);
  return {
    objects: Object.fromEntries(
      rows.rows.map((row) => [
        row.id,
        {
          id: row.id,
          name: row.name,
          kind: row.kind,
          state: states[row.state],
          attributes: attributes.get(row.revision_id)!,
          relations: relations.get(row.revision_id)!,
        },
      ])
    ),
    revisions: rows.rows.map((row) => ({
      kind: "entity",
      id: row.id,
      revisionId: row.revision_id,
      version: integer(row.valid_from),
    })),
  };
}

export async function readLayers(
  sql: Sql,
  scope: string,
  version: number
): Promise<ObjectRows<Layer>> {
  const result = await sql.query<{
    id: string;
    revision_id: string;
    valid_from: string;
    name: string;
    family: string;
    representation: string;
    color: string;
    profiles: number[];
    generator: string | null;
    representations: Layer["representations"] | null;
    facts: string[] | null;
  }>(
    "SELECT * FROM atlas_layers WHERE scope_id=$1 AND valid_from<=$2 AND (valid_to IS NULL OR valid_to>$2) ORDER BY id",
    [scope, version]
  );
  const attributes = await readAttributes(
    sql,
    result.rows.map((row) => row.revision_id)
  );
  return {
    objects: Object.fromEntries(
      result.rows.map((row) => [
        row.id,
        {
          id: row.id,
          name: row.name,
          family: row.family,
          representation: row.representation,
          color: row.color,
          profiles: row.profiles.map((profile) => profiles[profile]),
          generator: row.generator,
          ...(row.representations === null ? {} : { representations: row.representations }),
          ...(row.facts === null ? {} : { facts: row.facts }),
          schema: attributes.get(row.revision_id)!,
        },
      ])
    ),
    revisions: result.rows.map((row) => ({
      kind: "layer",
      id: row.id,
      revisionId: row.revision_id,
      version: integer(row.valid_from),
    })),
  };
}
