import { z } from "zod";
import { finite, geometrySchema, type Value } from "@atlas/domain";
import type { Geometry } from "geojson";
import { insertRows, type Sql } from "./database";
import { readAttributeShapes } from "./domainAttributeReader";

const stationChannels = new Set([
  "elevations",
  "discharges",
  "junctionInflows",
  "widths",
  "floorElevations",
  "floodDepths",
]);
const position = z.object({ x: finite, y: finite, z: finite.optional() }).strict();
const event = z
  .object({
    era: z.string().nullable().optional(),
    action: z.string().nullable().optional(),
    cause: z.string().nullable().optional(),
    depth: finite.nullable().optional(),
  })
  .strict();
const slice = z
  .object({
    floor: finite,
    area: finite,
    footprint: geometrySchema.nullable().optional(),
    sediment: finite.optional(),
  })
  .strict();
const cave = z
  .object({
    epoch: z.string(),
    dissolution: finite,
    collapse: finite,
    deposition: finite,
    iceDamage: finite,
  })
  .strict();
const exchange = z.object({ mechanism: z.string(), volume: finite, years: finite }).strict();

function schemaFor(name: string): z.ZodType | null {
  if (stationChannels.has(name)) return z.array(finite);
  if (["center", "outlet", "outletFrom"].includes(name)) return position;
  if (name === "outletPath") return z.array(position);
  if (name === "history") return z.array(event);
  if (name === "hypsometry") return z.array(slice);
  if (name === "epochHistory") return z.array(z.array(cave));
  return name === "waterExchange" ? exchange : null;
}

async function writeShape(sql: Sql, revision: string, name: string, value: Value): Promise<void> {
  const rows: unknown[][] = [];
  const visit = (node: Value, path: number[]) => {
    if (Array.isArray(node)) node.forEach((child, i) => visit(child, [...path, i]));
    else if (node !== null && typeof node === "object")
      rows.push([
        revision,
        name,
        path,
        Object.keys(node),
        Object.keys(node).filter((key) => node[key] === null),
      ]);
  };
  visit(value, []);
  await insertRows(
    sql,
    "atlas_attribute_shapes",
    ["revision_id", "attribute", "path", "properties", "null_properties"],
    rows
  );
}

async function writePositions(
  sql: Sql,
  revision: string,
  name: string,
  value: Value
): Promise<void> {
  const values = Array.isArray(value) ? value : [value],
    points = values.map((p) => position.parse(p));
  await sql.query(
    `INSERT INTO atlas_feature_positions(revision_id,role,ordinal,point)
    SELECT $1,$2,p.ordinal,ROW(p.x,p.y,p.z)::atlas_position FROM unnest($3::integer[],$4::float8[],$5::float8[],$6::float8[]) AS p(ordinal,x,y,z)`,
    [
      revision,
      name,
      points.map((_p, i) => i),
      points.map((p) => p.x),
      points.map((p) => p.y),
      points.map((p) => p.z ?? 0),
    ]
  );
}

async function writeSeries(
  sql: Sql,
  revision: string,
  name: string,
  values: number[],
  geometry: Geometry | null
): Promise<void> {
  const parts =
    geometry?.type === "MultiLineString"
      ? geometry.coordinates.map((part) => part.length)
      : geometry?.type === "LineString"
        ? [geometry.coordinates.length]
        : [];
  const aligned = parts.reduce((a, b) => a + b, 0) === values.length;
  let part = 0,
    station = 0;
  const rows = values.map((value) => {
    if (aligned && station === parts[part]) {
      part++;
      station = 0;
    }
    return [revision, name, part, station++, value];
  });
  await insertRows(
    sql,
    "atlas_stations",
    ["revision_id", "channel", "part", "station", "value"],
    rows
  );
}

async function writeHistory(sql: Sql, revision: string, name: string, value: Value): Promise<void> {
  if (name === "history") {
    await insertRows(
      sql,
      "atlas_construction_events",
      ["revision_id", "ordinal", "era", "action", "cause", "depth"],
      z
        .array(event)
        .parse(value)
        .map((v, i) => [
          revision,
          i,
          v.era ?? null,
          v.action ?? null,
          v.cause ?? null,
          v.depth ?? null,
        ])
    );
  } else if (name === "epochHistory") {
    const stations = z.array(z.array(cave)).parse(value);
    await insertRows(
      sql,
      "atlas_cave_stations",
      ["revision_id", "station"],
      stations.map((_s, i) => [revision, i])
    );
    await insertRows(
      sql,
      "atlas_cave_events",
      [
        "revision_id",
        "station",
        "ordinal",
        "epoch",
        "dissolution",
        "collapse",
        "deposition",
        "ice_damage",
      ],
      stations.flatMap((s, i) =>
        s.map((v, j) => [
          revision,
          i,
          j,
          v.epoch,
          v.dissolution,
          v.collapse,
          v.deposition,
          v.iceDamage,
        ])
      )
    );
  }
}

async function writeKnown(
  sql: Sql,
  revision: string,
  name: string,
  value: Value,
  geometry: Geometry | null
): Promise<void> {
  if (stationChannels.has(name))
    return writeSeries(sql, revision, name, z.array(finite).parse(value), geometry);
  if (["center", "outlet", "outletFrom", "outletPath"].includes(name))
    return writePositions(sql, revision, name, value);
  if (name === "history" || name === "epochHistory")
    return writeHistory(sql, revision, name, value);
  if (name === "hypsometry") {
    await insertRows(
      sql,
      "atlas_hypsometry",
      ["revision_id", "ordinal", "floor", "area", "footprint", "sediment"],
      z
        .array(slice)
        .parse(value)
        .map((v, i) => [
          revision,
          i,
          v.floor,
          v.area,
          v.footprint ? JSON.stringify(v.footprint) : null,
          v.sediment ?? 0,
        ]),
      ["footprint"]
    );
  } else if (name === "waterExchange") {
    const v = exchange.parse(value);
    await sql.query("INSERT INTO atlas_water_exchange VALUES($1,$2,$3,$4)", [
      revision,
      v.mechanism,
      v.volume,
      v.years,
    ]);
  }
}

export async function writeDomainAttributes(
  sql: Sql,
  revision: string,
  attributes: Record<string, Value>,
  geometry: Geometry | null
): Promise<Record<string, Value>> {
  const projected = Object.assign(Object.create(null), attributes) as Record<string, Value>;
  for (const [name, value] of Object.entries(attributes)) {
    if (!schemaFor(name)?.safeParse(value).success) continue;
    await writeKnown(sql, revision, name, value, geometry);
    await writeShape(sql, revision, name, value);
    projected[name] = Array.isArray(value) ? [] : (Object.create(null) as Record<string, Value>);
  }
  return projected;
}

export async function readDomainAttributes(
  sql: Sql,
  values: Map<string, Record<string, Value>>,
  ids: string[]
): Promise<void> {
  const relevant = ids.filter((id) =>
    Object.keys(values.get(id)!).some((key) => schemaFor(key) !== null)
  );
  if (relevant.length === 0) return;
  const stations = await sql.query<{ revision_id: string; channel: string; value: number }>(
    "SELECT * FROM atlas_stations WHERE revision_id=ANY($1::uuid[]) ORDER BY channel,part,station",
    [relevant]
  );
  for (const row of stations.rows) {
    const attributes = values.get(row.revision_id)!;
    (attributes[row.channel] as Value[]).push(row.value);
  }
  await readAttributeShapes(sql, values, relevant);
}
