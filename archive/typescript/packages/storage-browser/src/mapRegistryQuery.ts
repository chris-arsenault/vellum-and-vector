import type { SqlValue } from "@sqlite.org/sqlite-wasm";
import type { MapRegistryQuery } from "@atlas/map";

export function mapRegistryWhere(query: MapRegistryQuery) {
  const clauses: string[] = [],
    bind: SqlValue[] = [];
  const add = (sql: string, ...values: SqlValue[]) => {
    clauses.push(sql);
    bind.push(...values);
  };
  if (query.named) clauses.push("c.named=1");
  if (query.protectedOnly) clauses.push("json_extract(c.values_json,'$.protected')=1");
  if (query.type) add("json_extract(c.type,'$.id')=?", query.type);
  if (query.search) add("instr(lower(c.search),lower(?))>0", query.search);
  for (const key of ["status", "state", "profile", "space"] as const)
    if (query[key]) add("json_extract(c.values_json,?)=?", mapRegistryPath(key), query[key]);
  for (const filter of query.attributes) attribute(filter, add);
  return { sql: clauses.length ? clauses.join(" AND ") : "1", bind };
}
function attribute(
  filter: MapRegistryQuery["attributes"][number],
  add: (sql: string, ...values: SqlValue[]) => void
) {
  const path = mapRegistryPath(filter.key);
  add("json_extract(c.values_json,?) IS NOT NULL", path);
  if (filter.text)
    add("instr(lower(CAST(json_extract(c.values_json,?) AS TEXT)),lower(?))>0", path, filter.text);
  if (filter.min !== "")
    add(
      "json_type(c.values_json,?) IN ('integer','real') AND json_extract(c.values_json,?)>=?",
      path,
      path,
      Number(filter.min)
    );
  if (filter.max !== "")
    add(
      "json_type(c.values_json,?) IN ('integer','real') AND json_extract(c.values_json,?)<=?",
      path,
      path,
      Number(filter.max)
    );
}
export function mapRegistryPath(key: string) {
  return `$.${JSON.stringify(key)}`;
}
