import { requireThat, valueSchema, type Value } from "@atlas/domain";
import { flattenValue, restoreValue, type ValueRow } from "./typedValues";
import { insertRows, type Sql } from "./database";
import { readDomainAttributes, writeDomainAttributes } from "./domainAttributes";
import type { Geometry } from "geojson";

export interface AttributeRecord {
  revision: string;
  attributes: Record<string, unknown>;
  geometry: Geometry | null;
}

export async function writeAttributes(sql: Sql, records: AttributeRecord[]): Promise<void> {
  const rows: unknown[][] = [];
  for (const record of records) {
    const attributes = valueSchema.parse(record.attributes);
    requireThat(
      attributes !== null && typeof attributes === "object" && !Array.isArray(attributes),
      "invalid_attributes",
      "Attributes require a record."
    );
    const projected = await writeDomainAttributes(
      sql,
      record.revision,
      attributes,
      record.geometry
    );
    for (const row of flattenValue(projected))
      rows.push([
        record.revision,
        row.path,
        row.ordinal,
        row.kind === "record" ? "object" : row.kind === "list" ? "array" : row.kind,
        row.text_value,
        row.number_value,
        row.boolean_value,
      ]);
  }
  await insertRows(
    sql,
    "atlas_attributes",
    ["revision_id", "path", "ordinal", "kind", "text_value", "number_value", "bool_value"],
    rows
  );
}

export async function readAttributes(
  sql: Sql,
  revisions: string[]
): Promise<Map<string, Record<string, Value>>> {
  if (revisions.length === 0) return new Map();
  const result = await sql.query<{
    revision_id: string;
    path: string[];
    ordinal: number;
    kind: string;
    text_value: string | null;
    number_value: number | null;
    bool_value: boolean | null;
  }>(
    `SELECT revision_id,path,ordinal,kind,text_value,number_value::float8 AS number_value,bool_value
      FROM atlas_attributes WHERE revision_id=ANY($1::uuid[]) ORDER BY cardinality(path),ordinal`,
    [revisions]
  );
  const groups = new Map<string, ValueRow[]>();
  for (const row of result.rows) {
    const group = groups.get(row.revision_id) ?? [];
    group.push({
      ...row,
      kind: (row.kind === "object"
        ? "record"
        : row.kind === "array"
          ? "list"
          : row.kind) as ValueRow["kind"],
      boolean_value: row.bool_value,
    });
    groups.set(row.revision_id, group);
  }
  const values = new Map<string, Record<string, Value>>();
  for (const revision of revisions) {
    const rows = groups.get(revision),
      value = rows ? restoreValue(rows) : (Object.create(null) as Record<string, Value>);
    requireThat(
      value !== null && typeof value === "object" && !Array.isArray(value),
      "invalid_attributes",
      "Stored attributes require records."
    );
    values.set(revision, value);
  }
  await readDomainAttributes(sql, values, revisions);
  return values;
}
