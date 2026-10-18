import { requireThat, type TemplateInstance } from "@atlas/domain";
import { insertRows, type Sql } from "./database";

export async function writeTemplateInstances(
  sql: Sql,
  world: string,
  owner: string,
  version: number,
  values: TemplateInstance[]
): Promise<void> {
  for (const instance of values) {
    const definition = await sql.query(
      "SELECT 1 FROM atlas_template_definitions d JOIN atlas_scopes s ON s.id=d.scope_id WHERE d.scope_id=$1 AND s.owner=$2 AND s.sealed",
      [instance.definitionScope, owner]
    );
    requireThat(
      definition.rowCount === 1,
      "not_found",
      "Instance definition is not available in this actor's library."
    );
    await insertRows(
      sql,
      "atlas_template_instances",
      ["world_id", "id", "definition_scope", "root_area_id", "created_version"],
      [[world, instance.id, instance.definitionScope, instance.rootAreaId, version]]
    );
    await insertRows(
      sql,
      "atlas_template_instance_members",
      ["world_id", "instance_id", "definition_scope", "definition_id", "object_id", "kind"],
      instance.members.map((m) => [
        world,
        instance.id,
        instance.definitionScope,
        m.definitionId,
        m.objectId,
        m.kind,
      ])
    );
    await insertRows(
      sql,
      "atlas_template_instance_layers",
      ["world_id", "instance_id", "definition_scope", "definition_id", "layer_id"],
      instance.layers.map((l) => [
        world,
        instance.id,
        instance.definitionScope,
        l.definitionId,
        l.layerId,
      ])
    );
  }
}
