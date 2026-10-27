import type { SqlValue } from "@sqlite.org/sqlite-wasm";
import type { RegistryQuery, AttributeFilter } from "@atlas/domain";

export function registryWhere(query: RegistryQuery) {
  const clauses: string[] = [],
    bind: SqlValue[] = [];
  const add = (sql: string, ...values: SqlValue[]) => {
    clauses.push(sql);
    bind.push(...values);
  };
  if (query.named) clauses.push("r.named=1");
  if (query.protectedOnly) clauses.push("json_extract(r.data,'$.protected')=1");
  if (query.type) add("json_extract(r.type,'$.id')=?", query.type);
  if (query.search) add("instr(lower(r.search),lower(?))>0", query.search);
  for (const key of ["status", "state", "profile", "space"] as const)
    if (query[key]) add("json_extract(r.data,?)=?", registryPath(key), query[key]);
  for (const filter of query.attributes) addAttribute(filter, add);
  return { sql: clauses.length ? clauses.join(" AND ") : "1", bind };
}
function addAttribute(filter: AttributeFilter, add: (sql: string, ...values: SqlValue[]) => void) {
  const path = registryPath(filter.key);
  add("json_extract(r.data,?) IS NOT NULL", path);
  if (filter.text)
    add("instr(lower(CAST(json_extract(r.data,?) AS TEXT)),lower(?))>0", path, filter.text);
  if (filter.min !== "")
    add(
      "json_type(r.data,?) IN ('integer','real') AND json_extract(r.data,?)>=?",
      path,
      path,
      Number(filter.min)
    );
  if (filter.max !== "")
    add(
      "json_type(r.data,?) IN ('integer','real') AND json_extract(r.data,?)<=?",
      path,
      path,
      Number(filter.max)
    );
}
export function registryPath(key: string) {
  return `$.${JSON.stringify(key)}`;
}
