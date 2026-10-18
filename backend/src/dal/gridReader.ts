import { createGrid, gridSchema, requireThat, type Grid, type SpatialScope } from "@atlas/domain";
import { readWaterBodies } from "./waterBodies";
import type { Sql } from "./database";

interface GridRow {
  id: string;
  bounds: [number, number, number, number];
  width: number;
  height: number;
  active: boolean[] | null;
  measures: number[] | null;
  has_water_bodies: boolean;
  space_id: string | null;
  crs_id: string | null;
  time_context: string | null;
}

export async function gridMetadata(
  sql: Sql,
  world: string,
  id: string
): Promise<Omit<GridRow, "active" | "measures">> {
  const result = await sql.query<GridRow>(
    "SELECT id,bounds,width,height,has_water_bodies,space_id,crs_id,time_context FROM atlas_grids WHERE world_id=$1 AND id=$2 AND sealed",
    [world, id]
  );
  requireThat(result.rowCount === 1, "not_found", "Numerical artifact not found.");
  return result.rows[0];
}

export async function readGrid(
  sql: Sql,
  world: string,
  id: string,
  scope: SpatialScope,
  channels?: string[]
): Promise<Grid> {
  const metadata = await gridMetadata(sql, world, id);
  const mask = await sql.query<{ active: boolean[] | null; measures: number[] | null }>(
    "SELECT active,measures FROM atlas_grids WHERE world_id=$1 AND id=$2",
    [world, id]
  );
  const layout = { ...metadata, ...mask.rows[0] };
  requireThat(
    scope.worldId === world &&
      (metadata.space_id === null || metadata.space_id === scope.spaceId) &&
      (metadata.crs_id === null || metadata.crs_id === scope.crsId) &&
      (metadata.time_context === null || metadata.time_context === scope.time),
    "grid_scope_mismatch",
    "Numerical artifact does not match its declared reference."
  );
  const values = await sql.query<{ name: string; values: number[]; unit: string }>(
    "SELECT name,values,unit FROM atlas_grid_channels WHERE grid_id=$1 AND ($2::text[] IS NULL OR name=ANY($2::text[])) ORDER BY name",
    [id, channels ?? null]
  );
  requireThat(
    !channels || channels.every((name) => values.rows.some((row) => row.name === name)),
    "missing_channel",
    "A requested numerical channel is unavailable."
  );
  const legacy = legacyLayout(layout, scope);
  const grid: Grid = {
    id,
    scope,
    bounds: metadata.bounds,
    width: metadata.width,
    height: metadata.height,
    active: layout.active
      ? Uint8Array.from(layout.active, (value) => (value ? 1 : 0))
      : legacy!.active,
    measures: layout.measures ? Float64Array.from(layout.measures) : legacy!.measures,
    channels: Object.fromEntries(
      values.rows.map((row) => [row.name, Float64Array.from(row.values)])
    ),
    units: Object.fromEntries(values.rows.map((row) => [row.name, row.unit])),
    waterBodies: metadata.has_water_bodies ? await readWaterBodies(sql, id) : null,
  };
  return gridSchema.parse(grid);
}

function legacyLayout(metadata: GridRow, scope: SpatialScope): Grid | null {
  if (metadata.active !== null && metadata.measures !== null) return null;
  const layout = createGrid(metadata.id, scope, metadata.width, metadata.height);
  requireThat(
    layout.bounds.every((n, i) => n === metadata.bounds[i]),
    "legacy_grid_scope",
    "Legacy grid coverage must match its retained bounds before reconstructing sample measures."
  );
  return layout;
}

export interface GridWindow {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface GridWindowData {
  gridId: string;
  gridWidth: number;
  gridHeight: number;
  bounds: [number, number, number, number];
  window: GridWindow;
  channels: Record<string, number[]>;
  units: Record<string, string>;
}

export async function readGridWindow(
  sql: Sql,
  world: string,
  id: string,
  channels: string[],
  window: GridWindow
): Promise<GridWindowData> {
  const metadata = await gridMetadata(sql, world, id);
  requireThat(
    [window.x, window.y, window.width, window.height].every(Number.isSafeInteger) &&
      window.x >= 0 &&
      window.y >= 0 &&
      window.width > 0 &&
      window.height > 0 &&
      window.x + window.width <= metadata.width &&
      window.y + window.height <= metadata.height,
    "invalid_grid_window",
    "A field window must lie within its numerical grid."
  );
  const result = await sql.query<{ name: string; unit: string; values: number[] }>(
    `SELECT c.name,c.unit,c.values[(r.i*g.width+$4+1):(r.i*g.width+$4+$6)] AS values FROM atlas_grid_channels c
      JOIN atlas_grids g ON g.id=c.grid_id CROSS JOIN LATERAL generate_series($5::integer,$5+$7-1) r(i)
      WHERE g.world_id=$1 AND g.id=$2 AND c.name=ANY($3::text[]) ORDER BY c.name,r.i`,
    [world, id, channels, window.x, window.y, window.width, window.height]
  );
  const values = Object.create(null) as Record<string, number[]>,
    units = Object.create(null) as Record<string, string>;
  for (const row of result.rows) {
    values[row.name] ??= [];
    values[row.name].push(...row.values);
    units[row.name] = row.unit;
  }
  requireThat(
    channels.every((channel) => Object.hasOwn(values, channel)),
    "missing_channel",
    "A requested numerical channel is unavailable."
  );
  return {
    gridId: id,
    gridWidth: metadata.width,
    gridHeight: metadata.height,
    bounds: metadata.bounds,
    window,
    channels: values,
    units,
  };
}
