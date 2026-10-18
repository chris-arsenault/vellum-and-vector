import { geometrySchema, requireThat, type Value } from "@atlas/domain";
import type { Sql } from "./database";

type AttributeMap = Map<string, Record<string, Value>>;

async function readPositions(sql: Sql, values: AttributeMap, ids: string[]): Promise<void> {
  const rows = await sql.query<{
    revision_id: string;
    role: string;
    x: number;
    y: number;
    z: number;
  }>(
    "SELECT revision_id,role,(point).x AS x,(point).y AS y,(point).z AS z FROM atlas_feature_positions WHERE revision_id=ANY($1::uuid[]) ORDER BY ordinal",
    [ids]
  );
  for (const row of rows.rows) {
    const value = { x: row.x, y: row.y, z: row.z },
      attributes = values.get(row.revision_id)!;
    if (row.role === "outletPath") (attributes[row.role] as Value[]).push(value);
    else attributes[row.role] = value;
  }
}

async function readConstruction(sql: Sql, values: AttributeMap, ids: string[]): Promise<void> {
  const rows = await sql.query<{
    revision_id: string;
    era: string | null;
    action: string | null;
    cause: string | null;
    depth: number | null;
  }>("SELECT * FROM atlas_construction_events WHERE revision_id=ANY($1::uuid[]) ORDER BY ordinal", [
    ids,
  ]);
  for (const row of rows.rows)
    (values.get(row.revision_id)!.history as Value[]).push({
      era: row.era,
      action: row.action,
      cause: row.cause,
      depth: row.depth,
    });
  const stations = await sql.query<{ revision_id: string; station: number }>(
    "SELECT * FROM atlas_cave_stations WHERE revision_id=ANY($1::uuid[]) ORDER BY station",
    [ids]
  );
  for (const row of stations.rows) (values.get(row.revision_id)!.epochHistory as Value[]).push([]);
  const events = await sql.query<{
    revision_id: string;
    station: number;
    epoch: string;
    dissolution: number;
    collapse: number;
    deposition: number;
    ice_damage: number;
  }>("SELECT * FROM atlas_cave_events WHERE revision_id=ANY($1::uuid[]) ORDER BY station,ordinal", [
    ids,
  ]);
  for (const row of events.rows)
    (values.get(row.revision_id)!.epochHistory as Value[][])[row.station].push({
      epoch: row.epoch,
      dissolution: row.dissolution,
      collapse: row.collapse,
      deposition: row.deposition,
      iceDamage: row.ice_damage,
    });
}

async function readWater(sql: Sql, values: AttributeMap, ids: string[]): Promise<void> {
  const slices = await sql.query<{
    revision_id: string;
    floor: number;
    area: number;
    footprint: string | null;
    sediment: number;
  }>(
    "SELECT revision_id,floor,area,ST_AsGeoJSON(footprint) AS footprint,sediment FROM atlas_hypsometry WHERE revision_id=ANY($1::uuid[]) ORDER BY ordinal",
    [ids]
  );
  for (const row of slices.rows)
    (values.get(row.revision_id)!.hypsometry as Value[]).push({
      floor: row.floor,
      area: row.area,
      footprint: row.footprint
        ? (geometrySchema.parse(JSON.parse(row.footprint)) as unknown as Value)
        : null,
      sediment: row.sediment,
    });
  const exchanges = await sql.query<{
    revision_id: string;
    mechanism: string;
    volume: number;
    years: number;
  }>("SELECT * FROM atlas_water_exchange WHERE revision_id=ANY($1::uuid[])", [ids]);
  for (const row of exchanges.rows)
    values.get(row.revision_id)!.waterExchange = {
      mechanism: row.mechanism,
      volume: row.volume,
      years: row.years,
    };
}

export async function readAttributeShapes(
  sql: Sql,
  values: AttributeMap,
  ids: string[]
): Promise<void> {
  await readPositions(sql, values, ids);
  await readConstruction(sql, values, ids);
  await readWater(sql, values, ids);
  const rows = await sql.query<{
    revision_id: string;
    attribute: string;
    path: number[];
    properties: string[];
    null_properties: string[];
  }>(
    "SELECT * FROM atlas_attribute_shapes WHERE revision_id=ANY($1::uuid[]) ORDER BY cardinality(path)",
    [ids]
  );
  for (const row of rows.rows) {
    let value = values.get(row.revision_id)![row.attribute];
    for (const index of row.path) {
      requireThat(
        Array.isArray(value),
        "invalid_attribute_shape",
        "Attribute shape requires an indexed list."
      );
      value = value[index];
    }
    requireThat(
      value !== null && typeof value === "object" && !Array.isArray(value),
      "invalid_attribute_shape",
      "Attribute shape requires a record."
    );
    for (const key of Object.keys(value)) if (!row.properties.includes(key)) delete value[key];
    for (const key of row.null_properties) value[key] = null;
  }
}
