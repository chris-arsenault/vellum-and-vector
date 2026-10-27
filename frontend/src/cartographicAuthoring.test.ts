import {
  fixtureWorld,
  fixtureState,
  undoWorld,
  commitCommand,
  readRaster,
  readScene,
} from "./testSupport/workspaceFixture";
import { expect, it } from "vitest";
import { makeCommand } from "./useAtlas";
import { sample, type World } from "@atlas/domain";

async function elevation(world: World, fieldId: string, x = 500) {
  return sample((await readRaster(world.id, fieldId, "elevation")).field, "elevation", {
    x,
    y: 500,
    z: 0,
  });
}

it("paints a complete stroke once, supports erase and smooth, and undoes all its samples together", async () => {
  const initial = fixtureWorld({ name: "Stroke", seed: 7, width: 1000, height: 1000 }),
    areaId = Object.keys(initial.areas)[0];
  let world = (
    await commitCommand(
      initial.id,
      makeCommand(initial, "createField", {
        areaId,
        layerId: "elevation",
        resolution: 11,
        value: 0,
      })
    )
  ).candidate;
  const fieldId = world.fields[0].id;
  const command = makeCommand(world, "sculptField", {
    areaId,
    channel: "elevation",
    center: { x: 200, y: 500, z: 0 },
    stroke: [
      { x: 200, y: 500, z: 0 },
      { x: 800, y: 500, z: 0 },
    ],
    radius: 60,
    mode: "add",
    delta: 20,
  });
  world = (await commitCommand(world.id, command)).candidate;
  const row = await Promise.all(
    Array.from({ length: 11 }, (_, i) => elevation(world, fieldId, i * 100))
  );
  [0, 0, 20, 20, 20, 20, 20, 20, 20, 0, 0].forEach((expected, i) =>
    expect(row[i]).toBeCloseTo(expected, 0)
  );
  expect(fixtureState(world.id).history[0].operationId).toBe(command.operationId);
  const original = fixtureState(world.id).snapshot.numerical[fieldId];
  world = (
    await commitCommand(
      world.id,
      makeCommand(world, "sculptField", {
        areaId,
        channel: "elevation",
        center: { x: 500, y: 500, z: 0 },
        radius: 60,
        mode: "set",
        delta: 0,
      })
    )
  ).candidate;
  expect(await elevation(world, fieldId)).toBeCloseTo(0, 0);
  expect(original.channels.elevation[60]).toBe(0);
  world = await undoWorld(world.id, fixtureState(world.id).history[0].operationId);
  expect(await elevation(world, fieldId)).toBeCloseTo(20, 0);
  world = (
    await commitCommand(
      world.id,
      makeCommand(world, "sculptField", {
        areaId,
        channel: "elevation",
        center: { x: 500, y: 500, z: 0 },
        radius: 60,
        mode: "smooth",
        delta: 1,
      })
    )
  ).candidate;
  expect(await elevation(world, fieldId)).toBeGreaterThan(0);
  expect(await elevation(world, fieldId)).toBeLessThan(20);
  world = await undoWorld(world.id, fixtureState(world.id).history[0].operationId);
  await undoWorld(world.id, command.operationId);
  expect(
    await Promise.all(Array.from({ length: 11 }, (_, i) => elevation(world, fieldId, i * 100)))
  ).toEqual(new Array(11).fill(0));
});

it("keeps the full geometry of a feature crossing the viewport so editing cannot truncate it", async () => {
  const initial = fixtureWorld({ name: "Viewport", seed: 7, width: 1000, height: 1000 }),
    areaId = Object.keys(initial.areas)[0],
    id = crypto.randomUUID();
  const geometry = {
    type: "LineString",
    coordinates: [
      [100, 500],
      [500, 500],
      [900, 500],
    ],
  };
  await commitCommand(
    initial.id,
    makeCommand(initial, "putFeature", {
      areaId,
      feature: {
        id,
        name: "Long road",
        kind: "road",
        layerId: "roads",
        geometry,
        attributes: {},
        relations: [],
        protected: true,
      },
    })
  );
  expect((await readScene(initial.id, areaId, [400, 400, 600, 600]))[0].geometry).toEqual(geometry);
  expect(await readScene(initial.id, areaId, [0, 0, 50, 50])).toEqual([]);
});
