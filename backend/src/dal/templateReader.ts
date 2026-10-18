import { profiles, requireThat, type TemplateDefinition, type TemplateSocket } from "@atlas/domain";
import { integer, type Sql } from "./database";
import { readAreas } from "./areaReader";
import { readEntities, readFeatures, readLayers } from "./objectReaders";
import { readConnections, readNodes, readReaches } from "./networkRows";
import { readTemplateConstraints } from "./templateConstraints";

export async function readTemplate(sql: Sql, scope: string): Promise<TemplateDefinition> {
  const root = await sql.query<{
    id: string;
    version: string;
    name: string;
    units: "metre" | "foot";
    parent_profiles: number[];
    root_area_id: string | null;
  }>("SELECT * FROM atlas_template_definitions WHERE scope_id=$1", [scope]);
  requireThat(root.rowCount === 1, "not_found", "Template definition not found.");
  const r = root.rows[0];
  requireThat(
    r.root_area_id !== null,
    "legacy_template_transition",
    "This prototype template needs its located area hierarchy imported before use."
  );
  const members = await sql.query<{ kind: string; id: string }>(
    "SELECT kind,id FROM atlas_template_members WHERE scope_id=$1 ORDER BY ordinal",
    [scope]
  );
  const ids = (kind: string) => members.rows.filter((m) => m.kind === kind).map((m) => m.id);
  const areas = await readAreas(sql, scope, 1, ids("area")),
    features = await readFeatures(sql, scope, 1, ids("feature")),
    entities = await readEntities(sql, scope, 1, ids("entity")),
    layers = await readLayers(sql, scope, 1);
  const nodes = await readNodes(sql, scope, 1, ids("node")),
    reaches = await readReaches(sql, scope, 1, ids("reach")),
    connections = await readConnections(sql, scope, 1, ids("connection"));
  const contexts = await sql.query<{ target_id: string; world_scope: string; kind: string }>(
    "SELECT r.target_id,r.world_scope,o.kind FROM atlas_template_context_refs r JOIN atlas_objects o ON o.scope_id=r.scope_id AND o.id=r.target_id WHERE r.scope_id=$1 ORDER BY r.target_id",
    [scope]
  );
  return {
    id: r.id,
    version: integer(r.version),
    name: r.name,
    units: r.units,
    parentProfiles: r.parent_profiles.map((p) => profiles[p]),
    rootAreaId: r.root_area_id,
    areas: ids("area").map((id) => areas.objects[id]),
    features: ids("feature").map((id) => features.objects[id]),
    entities: ids("entity").map((id) => entities.objects[id]),
    layers: ids("layer").map((id) => layers.objects[id]),
    nodes: ids("node").map((id) => nodes.objects[id]),
    reaches: ids("reach").map((id) => reaches.objects[id]),
    connections: ids("connection").map((id) => connections.objects[id]),
    sockets: await readSockets(sql, scope),
    ...(await readTemplateConstraints(sql, scope)),
    contextReferences: contexts.rows.map((c) => ({
      id: c.target_id,
      worldId: c.world_scope,
      kind: c.kind,
    })),
  };
}
async function readSockets(sql: Sql, scope: string): Promise<TemplateSocket[]> {
  const result = await sql.query<{
    id: string;
    feature_id: string;
    x: number;
    y: number;
    z: number;
    kind: string;
    required: boolean;
    target_kinds: string[] | null;
    space_id: string | null;
    connects_to: string | null;
  }>(
    "SELECT id,feature_id,(point).x AS x,(point).y AS y,(point).z AS z,kind,required,target_kinds,space_id,connects_to FROM atlas_template_sockets WHERE scope_id=$1 ORDER BY ordinal",
    [scope]
  );
  return result.rows.map((s) => ({
    id: s.id,
    featureId: s.feature_id,
    position: { x: s.x, y: s.y, z: s.z },
    kind: s.kind,
    required: s.required,
    targetKinds: s.target_kinds,
    spaceId: s.space_id,
    connectsTo: s.connects_to,
  }));
}
