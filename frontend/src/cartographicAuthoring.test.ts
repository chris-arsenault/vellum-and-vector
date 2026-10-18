import { expect, it } from "vitest";
import { createWorld, session, undoWorld } from "./atlasState";
import { commitCommand } from "./atlasCommands";
import { readRaster, readScene } from "./atlasReads";
import { makeCommand } from "./useAtlas";

it("paints a complete stroke once, supports erase and smooth, and undoes all its samples together", () => {
  const initial = createWorld({ name: "Stroke", seed: 7, width: 1000, height: 1000 }),
    areaId = Object.keys(initial.areas)[0];
  let world = commitCommand(
    initial.id,
    makeCommand(initial, "createField", { areaId, layerId: "elevation", resolution: 11, value: 0 })
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
  world = commitCommand(world.id, command).candidate;
  const row = readRaster(world.id, fieldId, "elevation").values.slice(55, 66);
  expect(row).toEqual([0, 0, 20, 20, 20, 20, 20, 20, 20, 0, 0]);
  expect(session(world.id).history[0].operationId).toBe(command.operationId);
  const original = session(world.id).snapshot.numerical[fieldId];
  world = commitCommand(
    world.id,
    makeCommand(world, "sculptField", {
      areaId,
      channel: "elevation",
      center: { x: 500, y: 500, z: 0 },
      radius: 60,
      mode: "set",
      delta: 0,
    })
  ).candidate;
  expect(readRaster(world.id, fieldId, "elevation").values[60]).toBe(0);
  expect(original.channels.elevation[60]).toBe(0);
  world = undoWorld(world.id, session(world.id).history[0].operationId);
  expect(readRaster(world.id, fieldId, "elevation").values[60]).toBe(20);
  world = commitCommand(
    world.id,
    makeCommand(world, "sculptField", {
      areaId,
      channel: "elevation",
      center: { x: 500, y: 500, z: 0 },
      radius: 60,
      mode: "smooth",
      delta: 1,
    })
  ).candidate;
  expect(readRaster(world.id, fieldId, "elevation").values[60]).toBeGreaterThan(0);
  expect(readRaster(world.id, fieldId, "elevation").values[60]).toBeLessThan(20);
  world = undoWorld(world.id, session(world.id).history[0].operationId);
  undoWorld(world.id, command.operationId);
  expect(readRaster(world.id, fieldId, "elevation").values.every((value) => value === 0)).toBe(
    true
  );
});

it("keeps the full geometry of a feature crossing the viewport so editing cannot truncate it", () => {
  const initial = createWorld({ name: "Viewport", seed: 7, width: 1000, height: 1000 }),
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
  commitCommand(
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
  expect(readScene(initial.id, areaId, [400, 400, 600, 600])[0].geometry).toEqual(geometry);
  expect(readScene(initial.id, areaId, [0, 0, 50, 50])).toEqual([]);
});
