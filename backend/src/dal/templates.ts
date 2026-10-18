import { randomUUID } from "node:crypto";
import { profiles, requireThat, type TemplateDefinition } from "@atlas/domain";
import { Database, insertRows, integer, ownedVersion, type Sql } from "./database";
import { writeTemplateContent, writeTemplateSockets } from "./templateContent";
import { writeTemplateConstraints } from "./templateConstraints";
import { readTemplate } from "./templateReader";

async function authorizeContext(sql: Sql, owner: string, t: TemplateDefinition) {
  for (const world of new Set(t.contextReferences.map((r) => r.worldId)))
    await ownedVersion(sql, world, owner);
  if (t.workflow) {
    const result = await sql.query("SELECT 1 FROM atlas_scopes WHERE id=$1 AND owner=$2", [
      t.workflow.scope,
      owner,
    ]);
    requireThat(
      result.rowCount === 1,
      "not_found",
      "Template recipe workflow is not owned by this actor."
    );
  }
  const root = t.areas.find((a) => a.id === t.rootAreaId);
  requireThat(
    root?.parentId === null && t.areas.filter((a) => a.parentId === null).length === 1,
    "template_root",
    "A template has one detached root area."
  );
  requireThat(
    Number.isSafeInteger(t.version) && t.version > 0,
    "invalid_version",
    "Template versions are positive integers."
  );
}
export class TemplateRepository {
  constructor(private readonly database: Database) {}
  async save(
    owner: string,
    input: TemplateDefinition,
    expected: number | null
  ): Promise<TemplateDefinition> {
    return this.database.transaction(async (sql) => {
      await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `template:${owner}:${input.id}`,
      ]);
      const rows = await sql.query<{ version: string }>(
        "SELECT version FROM atlas_templates WHERE owner=$1 AND id=$2 FOR UPDATE",
        [owner, input.id]
      );
      const current = rows.rowCount ? integer(rows.rows[0].version) : null;
      requireThat(
        current === expected && input.version === (current ?? 0) + 1,
        "template_version_conflict",
        "Save a new version based on the latest template definition."
      );
      await authorizeContext(sql, owner, input);
      const scope = randomUUID();
      await sql.query("INSERT INTO atlas_scopes VALUES($1,$2,'template')", [scope, owner]);
      await writeTemplateContent(sql, scope, input);
      await writeTemplateSockets(sql, scope, input);
      await writeTemplateConstraints(sql, scope, input);
      await insertRows(
        sql,
        "atlas_template_versions",
        ["owner", "id", "version", "definition_scope"],
        [[owner, input.id, input.version, scope]]
      );
      await sql.query(
        "INSERT INTO atlas_templates(owner,id,version,definition_scope) VALUES($1,$2,$3,$4) ON CONFLICT(owner,id) DO UPDATE SET version=EXCLUDED.version,definition_scope=EXCLUDED.definition_scope,updated_at=now()",
        [owner, input.id, input.version, scope]
      );
      await sql.query("UPDATE atlas_scopes SET sealed=true WHERE id=$1", [scope]);
      return readTemplate(sql, scope);
    });
  }
  async read(owner: string, id: string, version?: number): Promise<TemplateDefinition> {
    return this.database.transaction(async (sql) => {
      const result =
        version === undefined
          ? await sql.query<{ definition_scope: string }>(
              "SELECT definition_scope FROM atlas_templates WHERE owner=$1 AND id=$2",
              [owner, id]
            )
          : await sql.query<{ definition_scope: string }>(
              "SELECT definition_scope FROM atlas_template_versions WHERE owner=$1 AND id=$2 AND version=$3",
              [owner, id, version]
            );
      requireThat(
        result.rowCount === 1,
        "not_found",
        "Template version not found in this library."
      );
      return readTemplate(sql, result.rows[0].definition_scope);
    }, true);
  }
  async list(owner: string) {
    return this.database.transaction(async (sql) => {
      const rows = await sql.query<{ id: string; version: string; name: string; profile: number }>(
        "SELECT t.id,t.version,d.name,d.profile FROM atlas_templates t JOIN atlas_template_definitions d ON d.scope_id=t.definition_scope WHERE t.owner=$1 ORDER BY t.updated_at DESC,t.id",
        [owner]
      );
      return rows.rows.map((r) => ({
        id: r.id,
        version: integer(r.version),
        name: r.name,
        profile: profiles[r.profile],
      }));
    }, true);
  }
}
