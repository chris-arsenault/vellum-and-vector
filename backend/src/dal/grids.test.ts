import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Client } from "pg";
import { createGrid, gridPosition, putChannel, rectangle, sample, type Grid } from "@atlas/domain";
import { testDatabase } from "../testDatabase";
import { Database } from "./database";
import { seedSpatialWorld } from "./spatialFixtures";
import { writeGrid } from "./gridWriter";
import { readGrid, readGridWindow } from "./gridReader";
import { readGridSelection } from "./gridSelections";

async function transitionPositions(database: Database): Promise<void> {
  await database.transaction(async (sql) => {
    await sql.query(await readFile("db/migrations/rollback/017_grid_positions.sql", "utf8"));
    await sql.query(await readFile("db/migrations/017_grid_positions.sql", "utf8"));
  });
}
async function selectedGrid(client: Client, grid: Grid) {
  const selection = await readGridSelection(
    client,
    grid.scope.worldId,
    grid.id,
    grid.scope,
    rectangle([35, 35, 45, 45]),
    ["elevation"]
  );
  expect(selection.channels.elevation.length).toBe(9);
  expect(sample(selection, "elevation", { x: 40, y: 40, z: 0 })).toBe(60);
  expect(selection.measures.reduce((a, b) => a + b, 0)).toBe(100);
}

it("retains immutable channel arrays, units and optional typed water-body data with scoped window reads", async () => {
  const db = await testDatabase();
  try {
    const database = new Database(db.client),
      { world, child } = await database.transaction(seedSpatialWorld);
    const grid = createGrid(
      randomUUID(),
      {
        worldId: world.id,
        areaId: child.id,
        spaceId: world.id,
        footprint: child.footprint,
        crsId: world.reference.id,
        revision: 1,
        time: "present",
        resolution: null,
      },
      7,
      7
    );
    putChannel(
      grid,
      "elevation",
      "metre",
      Float64Array.from(grid.active, (_v, i) => 100 - gridPosition(grid, i).x)
    );
    putChannel(grid, "temperature", "celsius", new Float64Array(49).fill(-8));
    grid.waterBodies = [
      {
        id: randomUUID(),
        footprint: rectangle([40, 40, 50, 50]),
        volume: 200,
        spill: 12,
        slices: [{ floor: 10, area: 100, footprint: null, sediment: 0 }],
        outlet: { x: 50, y: 45, z: 12 },
        outletFrom: null,
        suspended: 0,
        fixedLevel: 12,
        outletPath: [],
      },
    ];
    await database.transaction((sql) => writeGrid(sql, world.id, grid));
    const restored = await readGrid(db.client, world.id, grid.id, grid.scope, ["elevation"]);
    expect(restored.channels.elevation).toEqual(grid.channels.elevation);
    expect(Object.keys(restored.channels)).toEqual(["elevation"]);
    expect(restored.waterBodies).toEqual(grid.waterBodies);
    expect(restored.measures).toEqual(grid.measures);
    await selectedGrid(db.client, grid);
    const window = await readGridWindow(db.client, world.id, grid.id, ["temperature"], {
      x: 1,
      y: 2,
      width: 2,
      height: 3,
    });
    expect(window.channels).toEqual({ temperature: [-8, -8, -8, -8, -8, -8] });
    expect(window.units).toEqual({ temperature: "celsius" });
    await expect(
      readGridWindow(db.client, world.id, grid.id, ["temperature"], {
        x: 6,
        y: 6,
        width: 2,
        height: 1,
      })
    ).rejects.toThrow("within");
    await expect(
      db.client.query("UPDATE atlas_grid_channels SET values=ARRAY[0] WHERE grid_id=$1", [grid.id])
    ).rejects.toThrow();
    await transitionPositions(database);
    expect(
      (await readGrid(db.client, world.id, grid.id, grid.scope, ["elevation"])).waterBodies
    ).toEqual(grid.waterBodies);
  } finally {
    await db.close();
  }
});
