import { randomUUID, createHash } from "node:crypto";
import { requireThat, valueSchema, type Value } from "@atlas/domain";
import { insertRows, type Sql } from "./database";

export interface ValueRow {
  path: string[];
  ordinal: number;
  kind: "null" | "text" | "number" | "boolean" | "record" | "list";
  text_value: string | null;
  number_value: number | null;
  boolean_value: boolean | null;
}

function kindOf(value: Value): ValueRow["kind"] {
  if (value === null) return "null";
  if (Array.isArray(value)) return "list";
  if (typeof value === "object") return "record";
  return typeof value === "string" ? "text" : (typeof value as "number" | "boolean");
}

export function flattenValue(input: Value): ValueRow[] {
  const rows: ValueRow[] = [];
  const visit = (value: Value, path: string[]) => {
    const kind = kindOf(value);
    rows.push({
      path,
      ordinal: rows.length,
      kind,
      text_value: typeof value === "string" ? value : null,
      number_value: typeof value === "number" ? value : null,
      boolean_value: typeof value === "boolean" ? value : null,
    });
    if (value !== null && typeof value === "object")
      for (const [key, child] of Object.entries(value)) visit(child, [...path, key]);
  };
  visit(valueSchema.parse(input), []);
  return rows;
}

function rowValue(row: ValueRow): Value {
  if (row.kind === "record") return Object.create(null) as Record<string, Value>;
  if (row.kind === "list") return [];
  if (row.kind === "text") return row.text_value!;
  if (row.kind === "number") return row.number_value!;
  if (row.kind === "boolean") return row.boolean_value!;
  return null;
}

export function restoreValue(rows: ValueRow[]): Value {
  const nodes = new Map<string, Value>();
  for (const row of rows) {
    const value = rowValue(row),
      key = JSON.stringify(row.path);
    requireThat(!nodes.has(key), "invalid_value_tree", "Stored value contains duplicate paths.");
    nodes.set(key, value);
    if (row.path.length === 0) continue;
    const parent = nodes.get(JSON.stringify(row.path.slice(0, -1))),
      leaf = row.path.at(-1)!;
    requireThat(
      parent !== null && typeof parent === "object",
      "invalid_value_tree",
      "Stored value has a missing container."
    );
    if (Array.isArray(parent)) {
      requireThat(
        /^(0|[1-9][0-9]*)$/.test(leaf) && Number(leaf) === parent.length,
        "invalid_value_tree",
        "Stored list ordering is inconsistent."
      );
      parent.push(value);
    } else parent[leaf] = value;
  }
  requireThat(nodes.has("[]"), "invalid_value_tree", "Stored values require a root.");
  return valueSchema.parse(nodes.get("[]"));
}

export type ValuePurpose =
  "parameters" | "defaults" | "choices" | "epoch" | "continuation" | "binding" | "value";

export async function writeValues(
  sql: Sql,
  scope: string,
  input: Value,
  purpose: ValuePurpose,
  schemaId: string,
  schemaVersion = 1
): Promise<string> {
  return (
    await writeValueSets(sql, scope, [{ value: input, purpose, schemaId, schemaVersion }])
  )[0];
}

export async function writeValueSets(
  sql: Sql,
  scope: string,
  input: {
    value: Value;
    purpose: ValuePurpose;
    schemaId: string;
    schemaVersion?: number;
  }[]
): Promise<string[]> {
  if (input.length === 0) return [];
  const ids = input.map(() => randomUUID());
  await insertRows(
    sql,
    "atlas_value_sets",
    ["id", "scope_id", "purpose", "schema_id", "schema_version"],
    input.map((v, i) => [ids[i], scope, v.purpose, v.schemaId, v.schemaVersion ?? 1])
  );
  await insertRows(
    sql,
    "atlas_values",
    ["value_set", "path", "ordinal", "kind", "text_value", "number_value", "boolean_value"],
    input.flatMap((v, i) =>
      flattenValue(v.value).map((row) => [
        ids[i],
        row.path,
        row.ordinal,
        row.kind,
        row.text_value,
        row.number_value,
        row.boolean_value,
      ])
    )
  );
  await sql.query("UPDATE atlas_value_sets SET sealed=true WHERE id=ANY($1::uuid[])", [ids]);
  return ids;
}

export async function readValues(
  sql: Sql,
  scope: string,
  ids: string[]
): Promise<Map<string, Value>> {
  if (ids.length === 0) return new Map();
  const result = await sql.query<ValueRow & { value_set: string }>(
    `SELECT v.* FROM atlas_values v JOIN atlas_value_sets s ON s.id=v.value_set
    WHERE s.scope_id=$1 AND s.id=ANY($2::uuid[]) AND s.sealed ORDER BY cardinality(v.path),v.ordinal`,
    [scope, ids]
  );
  const grouped = new Map<string, ValueRow[]>();
  for (const row of result.rows) {
    const group = grouped.get(row.value_set) ?? [];
    group.push(row);
    grouped.set(row.value_set, group);
  }
  const values = new Map([...grouped].map(([id, rows]) => [id, restoreValue(rows)]));
  requireThat(
    ids.every((id) => values.has(id)),
    "not_found",
    "Typed value set not found in this scope."
  );
  return values;
}

function sortedValue(value: Value): Value {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortedValue(value[key])])
    );
  return value;
}

export function contentHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(sortedValue(valueSchema.parse(value))))
    .digest("hex");
}
