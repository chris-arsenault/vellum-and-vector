import { geometrySchema, type TemplateDefinition, type Trait } from "@atlas/domain";
import { insertRows, type Sql } from "./database";
import { writeValues, readValues } from "./typedValues";

const traitKinds = ["hard", "tendency", "derived", "exception"];
export async function writeTemplateConstraints(sql: Sql, scope: string, t: TemplateDefinition) {
  const r = t.requirements;
  if (r) {
    await insertRows(
      sql,
      "atlas_template_constraints",
      ["scope_id", "context_kinds", "maximum_slope", "street_access"],
      [[scope, r.contextKinds, r.maximumSlope, r.streetAccess]]
    );
    await insertRows(
      sql,
      "atlas_template_required_fields",
      ["scope_id", "ordinal", "field", "kind", "minimum", "maximum", "cause", "footprint"],
      r.fields.map((f, i) => [
        scope,
        i,
        f.field,
        traitKinds.indexOf(f.kind),
        f.minimum,
        f.maximum,
        f.cause,
        f.scope ? JSON.stringify(f.scope) : null,
      ]),
      ["footprint"]
    );
  }
  if (t.workflow) {
    const w = t.workflow;
    const parameters = await writeValues(
      sql,
      scope,
      w.parameters,
      "parameters",
      `recipe:${w.id}`,
      w.version
    );
    await insertRows(
      sql,
      "atlas_template_workflows",
      ["definition_scope", "workflow_scope", "workflow_id", "workflow_version", "parameters"],
      [[scope, w.scope, w.id, w.version, parameters]]
    );
  }
}
export async function readTemplateConstraints(sql: Sql, scope: string) {
  const root = await sql.query<{
    context_kinds: string[] | null;
    maximum_slope: number | null;
    street_access: boolean;
  }>("SELECT * FROM atlas_template_constraints WHERE scope_id=$1", [scope]);
  const fields = await sql.query<{
    field: string;
    kind: number;
    minimum: number;
    maximum: number;
    cause: string | null;
    footprint: string | null;
  }>(
    "SELECT *,ST_AsGeoJSON(footprint,15) AS footprint FROM atlas_template_required_fields WHERE scope_id=$1 ORDER BY ordinal",
    [scope]
  );
  const r = root.rows[0];
  const requirements = r
    ? {
        contextKinds: r.context_kinds,
        maximumSlope: r.maximum_slope,
        streetAccess: r.street_access,
        fields: fields.rows.map((f): Trait => ({
          field: f.field,
          kind: traitKinds[f.kind],
          minimum: f.minimum,
          maximum: f.maximum,
          cause: f.cause,
          scope: f.footprint ? geometrySchema.parse(JSON.parse(f.footprint)) : null,
        })),
      }
    : null;
  const workflows = await sql.query<{
    workflow_scope: string;
    workflow_id: string;
    workflow_version: string;
    parameters: string;
  }>("SELECT * FROM atlas_template_workflows WHERE definition_scope=$1", [scope]);
  const w = workflows.rows[0];
  const workflow: TemplateDefinition["workflow"] = w
    ? {
        scope: w.workflow_scope,
        id: w.workflow_id,
        version: Number(w.workflow_version),
        parameters: (await readValues(sql, scope, [w.parameters])).get(w.parameters) as NonNullable<
          TemplateDefinition["workflow"]
        >["parameters"],
      }
    : null;
  return { requirements, workflow };
}
