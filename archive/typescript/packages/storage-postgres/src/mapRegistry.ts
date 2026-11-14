import {
  validateRegistryRequest,
  registryPage,
  mapBounds,
  type MapRef,
  type MapRegistryRequest,
  type MapRegistryPage,
  type MapFeature,
  type MapFeatureType,
  type Geometry,
} from "@atlas/map";
import type { SqlReader } from "./database";
import type { PostgresMapCatalog } from "./mapCatalog";

/** SQL filters the immutable map catalogue; only the requested rows leave the backend. */
export class PostgresMapRegistry {
  constructor(
    private db: SqlReader,
    private maps: PostgresMapCatalog
  ) {}

  async read(reference: MapRef, request: MapRegistryRequest): Promise<MapRegistryPage> {
    validateRegistryRequest(request);
    const map = await this.maps.open(reference);
    const { sql: scope, values } = registryScope(reference, map.worldId, request);
    const filtered = registryFilter(request.query, values);
    const { rows: counts } = await this.db.query<{ total: string; matching: string }>(
      `${scope} SELECT count(*) AS total,count(*) FILTER(WHERE ${filtered.sql}) AS matching FROM scoped`,
      filtered.values
    );
    const total = Number(counts[0].total),
      matching = Number(counts[0].matching);
    const page = registryPage(request.page, request.limit, matching);
    const key = `$${filtered.values.length + 1}`,
      direction = request.sort.descending ? "DESC" : "ASC";
    const { rows } = await this.db.query<{
      map_id: string;
      revision: string;
      data: Omit<MapFeature, "geometry">;
      geometry: Geometry;
      type: MapFeatureType;
    }>(
      `${scope} SELECT map_id,revision,data,type,ST_AsGeoJSON(geometry,15,0)::json AS geometry FROM scoped
      WHERE ${filtered.sql} ORDER BY (v->>${key} IS NULL OR v->>${key}=''),
      CASE WHEN jsonb_typeof(v->${key})='number' THEN (v->>${key})::numeric END ${direction},
      lower(v->>${key}) ${direction},map_id,id LIMIT $${filtered.values.length + 2} OFFSET $${filtered.values.length + 3}`,
      [...filtered.values, request.sort.key, request.limit, page * request.limit]
    );
    const columns = await this.columns(scope, values),
      facets = await this.facets(scope, values);
    return {
      total,
      matching,
      page,
      columns,
      facets,
      rows: rows.map((row) => ({
        reference: { mapId: row.map_id, revision: row.revision },
        feature: { ...row.data, geometry: row.geometry },
        type: row.type,
        values: row.data.catalog.values,
      })),
    };
  }

  private async columns(scope: string, values: unknown[]): Promise<MapRegistryPage["columns"]> {
    const { rows } = await this.db.query<MapRegistryPage["columns"][number]>(
      `${scope}
      SELECT item->>'key' AS key,min(item->>'label') AS label,bool_or((item->>'numeric')::boolean) AS numeric
      FROM scoped,jsonb_array_elements(data#>'{catalog,columns}') WITH ORDINALITY AS c(item,ordinal)
      GROUP BY item->>'key' ORDER BY min(ordinal),item->>'key'`,
      values
    );
    return rows;
  }
  private async facets(scope: string, values: unknown[]): Promise<MapRegistryPage["facets"]> {
    const categories = {
      status: [],
      state: [],
      profile: [],
      space: [],
    } as MapRegistryPage["facets"]["categories"];
    for (const key of ["status", "state", "profile", "space"] as const) {
      const { rows } = await this.db.query<{ value: string }>(
        `${scope}
        SELECT DISTINCT v->>$${values.length + 1} AS value FROM scoped
        WHERE v->>$${values.length + 1} IS NOT NULL AND v->>$${values.length + 1}<>'' ORDER BY value`,
        [...values, key]
      );
      categories[key] = rows.map((row) => row.value);
    }
    const { rows } = await this.db.query<{ type: MapFeatureType }>(
      `${scope} SELECT DISTINCT type FROM scoped ORDER BY type`,
      values
    );
    return { categories, types: rows.map((row) => row.type) };
  }
}

function registryScope(reference: MapRef, worldId: string, request: MapRegistryRequest) {
  const values: unknown[] = [reference.mapId, reference.revision];
  let where = "(f.map_id=$1 AND f.revision=$2)";
  if (request.scope === "world") {
    values.push(worldId);
    where = `(${where} OR (f.map_id<>$1 AND m.descriptor->>'worldId'=$3
      AND EXISTS(SELECT 1 FROM map.heads h WHERE h.map_id=f.map_id AND h.revision=f.revision)))`;
  }
  if (request.bounds) {
    const bounds = mapBounds(request.bounds);
    const params = bounds.map((value) => {
      values.push(value);
      return `$${values.length}`;
    });
    const rectangle = `ST_MakeEnvelope(${params.join(",")},0)`;
    where += ` AND (ST_Intersects(f.geometry,${rectangle}) OR ST_Intersects(
      ST_SetSRID(ST_GeomFromGeoJSON(nullif(f.data->'footprint','null'::jsonb)),0),${rectangle}))`;
  }
  return {
    values,
    sql: `WITH scoped AS (
    SELECT f.*,f.data#>'{catalog,values}' AS v,
      (SELECT t.value FROM jsonb_array_elements(m.descriptor->'layers') l,
        jsonb_array_elements(l.value#>'{catalog,featureTypes}') t
        WHERE l.value->>'id'=f.layer_id AND t.value->>'id'=f.data->>'typeId') AS type
    FROM map.features f JOIN map.revisions m USING(map_id,revision) WHERE ${where})`,
  };
}
function registryFilter(query: MapRegistryRequest["query"], scopeValues: unknown[]) {
  const values = [...scopeValues],
    clauses: string[] = [];
  const bind = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (query.named) clauses.push("coalesce(data#>>'{attributes,nameStatus}','')<>'label'");
  if (query.protectedOnly) clauses.push("v->'protected'='true'::jsonb");
  if (query.type) clauses.push(`type->>'id'=${bind(query.type)}`);
  if (query.search)
    clauses.push(`strpos(lower(coalesce(name,'')||' '||
    array_to_string(ARRAY(SELECT jsonb_array_elements_text(type->'path')),' ')),lower(${bind(query.search)}))>0`);
  for (const key of ["status", "state", "profile", "space"] as const)
    if (query[key]) clauses.push(`v->>${bind(key)}=${bind(query[key])}`);
  for (const filter of query.attributes) attribute(filter, clauses, bind);
  return { sql: clauses.length ? clauses.join(" AND ") : "true", values };
}
function attribute(
  filter: MapRegistryRequest["query"]["attributes"][number],
  clauses: string[],
  bind: (value: unknown) => string
) {
  const key = bind(filter.key);
  clauses.push(`v->>${key} IS NOT NULL`);
  if (filter.text) clauses.push(`strpos(lower(v->>${key}),lower(${bind(filter.text)}))>0`);
  if (filter.min !== "")
    clauses.push(
      `CASE WHEN jsonb_typeof(v->${key})='number' THEN (v->>${key})::numeric>=${bind(Number(filter.min))} ELSE false END`
    );
  if (filter.max !== "")
    clauses.push(
      `CASE WHEN jsonb_typeof(v->${key})='number' THEN (v->>${key})::numeric<=${bind(Number(filter.max))} ELSE false END`
    );
}
