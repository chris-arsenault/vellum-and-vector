import { geometrySchema, type Grid, type Position, type WaterBody } from "@atlas/domain";
import { insertRows, type Sql } from "./database";

async function bodyPositions(sql: Sql, grid: Grid): Promise<void> {
  const rows = (grid.waterBodies ?? []).flatMap((body, i) => [
    ...[
      { role: "outlet", value: body.outlet },
      { role: "outletFrom", value: body.outletFrom },
    ]
      .filter((p) => p.value !== null)
      .map((p) => ({ body: i, role: p.role, ordinal: 0, value: p.value! })),
    ...(body.outletPath ?? []).map((value, ordinal) => ({ body: i, role: "path", ordinal, value })),
  ]);
  await insertRows(
    sql,
    "atlas_grid_body_positions",
    ["grid_id", "body_ordinal", "role", "ordinal", "x", "y", "z"],
    rows.map((row) => [
      grid.id,
      row.body,
      row.role,
      row.ordinal,
      row.value.x,
      row.value.y,
      row.value.z,
    ])
  );
}

export async function writeWaterBodies(sql: Sql, grid: Grid): Promise<void> {
  await insertRows(
    sql,
    "atlas_grid_water_bodies",
    ["grid_id", "ordinal", "id", "footprint", "volume", "spill", "suspended", "fixed_level"],
    (grid.waterBodies ?? []).map((body, i) => [
      grid.id,
      i,
      body.id,
      JSON.stringify(body.footprint),
      body.volume,
      body.spill,
      body.suspended,
      body.fixedLevel,
    ]),
    ["footprint"]
  );
  await insertRows(
    sql,
    "atlas_grid_lake_slices",
    ["grid_id", "body_ordinal", "ordinal", "floor", "area", "footprint", "sediment"],
    (grid.waterBodies ?? []).flatMap((body, i) =>
      body.slices.map((slice, j) => [
        grid.id,
        i,
        j,
        slice.floor,
        slice.area,
        slice.footprint ? JSON.stringify(slice.footprint) : null,
        slice.sediment,
      ])
    ),
    ["footprint"]
  );
  await insertRows(
    sql,
    "atlas_grid_body_flags",
    ["grid_id", "body_ordinal", "has_outlet_path"],
    (grid.waterBodies ?? []).map((body, i) => [grid.id, i, body.outletPath !== null])
  );
  await bodyPositions(sql, grid);
}

export async function readWaterBodies(sql: Sql, grid: string): Promise<WaterBody[]> {
  const bodies = await sql.query<{
    ordinal: number;
    id: string;
    footprint: string;
    volume: number;
    spill: number;
    suspended: number;
    fixed_level: number | null;
    has_outlet_path: boolean;
  }>(
    `SELECT b.ordinal,b.id,ST_AsGeoJSON(b.footprint,15) AS footprint,b.volume,b.spill,b.suspended,b.fixed_level,f.has_outlet_path
      FROM atlas_grid_water_bodies b JOIN atlas_grid_body_flags f ON f.grid_id=b.grid_id AND f.body_ordinal=b.ordinal
      WHERE b.grid_id=$1 ORDER BY b.ordinal`,
    [grid]
  );
  const slices = await sql.query<{
    body_ordinal: number;
    floor: number;
    area: number;
    footprint: string | null;
    sediment: number;
  }>(
    "SELECT body_ordinal,floor,area,ST_AsGeoJSON(footprint,15) AS footprint,sediment FROM atlas_grid_lake_slices WHERE grid_id=$1 ORDER BY ordinal",
    [grid]
  );
  const points = await sql.query<{
    body_ordinal: number;
    role: string;
    ordinal: number;
    x: number;
    y: number;
    z: number;
  }>("SELECT * FROM atlas_grid_body_positions WHERE grid_id=$1 ORDER BY ordinal", [grid]);
  const at = (body: number, role: string): Position | null => {
    const p = points.rows.find((p) => p.body_ordinal === body && p.role === role);
    return p ? { x: p.x, y: p.y, z: p.z } : null;
  };
  return bodies.rows.map((body) => ({
    id: body.id,
    footprint: geometrySchema.parse(JSON.parse(body.footprint)),
    volume: body.volume,
    spill: body.spill,
    suspended: body.suspended,
    fixedLevel: body.fixed_level,
    outlet: at(body.ordinal, "outlet"),
    outletFrom: at(body.ordinal, "outletFrom"),
    outletPath: body.has_outlet_path
      ? points.rows
          .filter((p) => p.body_ordinal === body.ordinal && p.role === "path")
          .map((p) => ({ x: p.x, y: p.y, z: p.z }))
      : null,
    slices: slices.rows
      .filter((slice) => slice.body_ordinal === body.ordinal)
      .map((slice) => ({
        floor: slice.floor,
        area: slice.area,
        footprint: slice.footprint ? geometrySchema.parse(JSON.parse(slice.footprint)) : null,
        sediment: slice.sediment,
      })),
  }));
}
