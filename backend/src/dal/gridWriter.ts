import { gridSchema, requireThat, type Grid } from "@atlas/domain";
import { insertRows, type Sql } from "./database";
import { writeWaterBodies } from "./waterBodies";

export async function writeGrid(sql: Sql, world: string, input: Grid): Promise<void> {
  const grid = gridSchema.parse(input);
  requireThat(
    grid.scope.worldId === world,
    "grid_scope_mismatch",
    "A numerical artifact belongs to its declared world."
  );
  await insertRows(
    sql,
    "atlas_grids",
    [
      "id",
      "world_id",
      "bounds",
      "width",
      "height",
      "measures",
      "has_water_bodies",
      "active",
      "footprint",
      "space_id",
      "crs_id",
      "time_context",
      "resolution",
    ],
    [
      [
        grid.id,
        world,
        grid.bounds,
        grid.width,
        grid.height,
        [...grid.measures],
        grid.waterBodies !== undefined && grid.waterBodies !== null,
        [...grid.active].map((value) => value === 1),
        JSON.stringify(grid.scope.footprint),
        grid.scope.spaceId,
        grid.scope.crsId,
        grid.scope.time,
        grid.scope.resolution,
      ],
    ],
    ["footprint"]
  );
  await insertRows(
    sql,
    "atlas_grid_channels",
    ["grid_id", "name", "values", "unit"],
    Object.entries(grid.channels).map(([name, values]) => [
      grid.id,
      name,
      [...values],
      grid.units[name],
    ])
  );
  await writeWaterBodies(sql, grid);
  await sql.query("UPDATE atlas_grids SET sealed=true WHERE id=$1", [grid.id]);
}
