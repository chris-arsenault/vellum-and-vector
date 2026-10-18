import {
  profiles,
  requireThat,
  type TemplateDefinition,
  type LocatedRepresentation,
} from "@atlas/domain";
import { insertRows, registerObjects, type Sql } from "./database";
import { allocateRevisions } from "./revisions";
import { writeArea } from "./areaWriter";
import {
  writeEntities,
  writeFeatureBases,
  writeLayers,
  writeConnections,
  type Revised,
} from "./objectWriters";
import { writeNodes, writeReaches } from "./networkRows";
import {
  writeRepresentations,
  representationIdentities,
  representationKey,
} from "./representations";

export async function writeTemplateContent(
  sql: Sql,
  scope: string,
  t: TemplateDefinition
): Promise<void> {
  const groups = {
    area: t.areas,
    feature: t.features,
    entity: t.entities,
    node: t.nodes,
    reach: t.reaches,
    connection: t.connections,
  };
  await registerObjects(sql, scope, [
    ...Object.entries(groups).flatMap(([kind, values]) => values.map((v) => ({ id: v.id, kind }))),
    ...t.contextReferences.map((r) => ({ id: r.id, kind: r.kind })),
  ]);
  await writeTemplateHeader(sql, scope, t);
  const revisions = await allocateRevisions(sql, scope, [
    ...Object.values(groups).flatMap((values) => values.map((v) => v.id)),
    ...t.layers.map((l) => l.id),
  ]);
  const revised = <T extends { id: string }>(values: T[]): Revised<T>[] =>
    values.map((value) => ({ revision: revisions.get(value.id)!, value }));
  const pending = [...t.areas],
    written = new Set<string>();
  while (pending.length) {
    const next = pending.findIndex((a) => a.parentId === null || written.has(a.parentId));
    requireThat(
      next >= 0,
      "template_area_cycle",
      "Template areas need an acyclic hierarchy within the definition."
    );
    const [area] = pending.splice(next, 1);
    await writeArea(sql, scope, 1, revisions.get(area.id)!, { ...area, spaceId: undefined });
    written.add(area.id);
  }
  await writeLayers(sql, scope, 1, revised(t.layers));
  await writeFeatureBases(sql, scope, 1, revised(t.features));
  await writeEntities(sql, scope, 1, revised(t.entities));
  await writeNodes(sql, scope, 1, revised(t.nodes));
  await writeReaches(sql, scope, 1, revised(t.reaches));
  await writeConnections(sql, scope, 1, revised(t.connections));
  await writeDetails(sql, scope, t);
  await insertRows(
    sql,
    "atlas_template_members",
    ["scope_id", "kind", "ordinal", "id"],
    [...Object.entries(groups), ["layer", t.layers] as const].flatMap(([kind, values]) =>
      values.map((v, i) => [scope, kind, i, v.id])
    )
  );
}
async function writeDetails(sql: Sql, scope: string, t: TemplateDefinition) {
  const details = t.features.flatMap((f) =>
    Object.entries(f.detail).map(([areaId, detail]) => ({ ...detail, featureId: f.id, areaId }))
  );
  const identities = await representationIdentities(sql, scope, details);
  const values: LocatedRepresentation[] = details.map((d) => ({
    ...d,
    id: identities.get(representationKey(d))!,
  }));
  const revisions = await allocateRevisions(
    sql,
    scope,
    values.map((v) => v.id)
  );
  await writeRepresentations(
    sql,
    scope,
    1,
    values.map((value) => ({ revision: revisions.get(value.id)!, value }))
  );
}
export async function writeTemplateSockets(sql: Sql, scope: string, t: TemplateDefinition) {
  for (const [i, s] of t.sockets.entries())
    await sql.query(
      `INSERT INTO atlas_template_sockets(scope_id,ordinal,id,feature_id,point,kind,required,target_kinds,space_id,connects_to)
    VALUES($1,$2,$3,$4,ROW($5,$6,$7)::atlas_position,$8,$9,$10,$11,$12)`,
      [
        scope,
        i,
        s.id,
        s.featureId,
        s.position.x,
        s.position.y,
        s.position.z,
        s.kind,
        s.required,
        s.targetKinds,
        s.spaceId ?? null,
        s.connectsTo ?? null,
      ]
    );
  await insertRows(
    sql,
    "atlas_template_context_refs",
    ["scope_id", "target_id", "world_scope"],
    t.contextReferences.map((r) => [scope, r.id, r.worldId])
  );
}
export async function writeTemplateHeader(sql: Sql, scope: string, t: TemplateDefinition) {
  const root = t.areas.find((a) => a.id === t.rootAreaId)!;
  const f = root.frame;
  await sql.query(
    `INSERT INTO atlas_template_definitions(scope_id,id,version,name,profile,parent_profiles,footprint,traits,frame,units,context,has_entities,has_layers,has_sockets,has_spaces,root_area_id)
    VALUES($1,$2,$3,$4,$5,$6,ST_SetSRID(ST_GeomFromGeoJSON($7::text),0),'{}',ROW(ROW($8,$9,$10)::atlas_position,$11,$12,$13)::atlas_frame,$14,$15,true,true,true,true,$16)`,
    [
      scope,
      t.id,
      t.version,
      t.name,
      profiles.indexOf(root.profile),
      t.parentProfiles.map((p) => profiles.indexOf(p)),
      JSON.stringify(root.footprint),
      f.origin.x,
      f.origin.y,
      f.origin.z,
      f.rotation,
      f.metresPerUnit,
      f.floor,
      t.units,
      root.context,
      root.id,
    ]
  );
}
