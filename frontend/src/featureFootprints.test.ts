import { expect, it } from "vitest";
import { rectangle } from "@atlas/domain";
import { createWorld, session, undoWorld } from "./atlasState";
import { commitCommand } from "./atlasCommands";
import { makeCommand } from "./useAtlas";
import { readFeature, exportWorld } from "./atlasReads";

it("authors the footprint independently, retains source position, exports one identity and restores it on undo", () => {
  const world = createWorld({ name: "Footprints", seed: 1, width: 1000, height: 1000 }),
    areaId = Object.keys(world.areas)[0],
    id = crypto.randomUUID();
  const initial = commitCommand(
    world.id,
    makeCommand(world, "putFeature", {
      areaId,
      feature: {
        id,
        name: "Spring",
        kind: "spring",
        layerId: "pois",
        geometry: { type: "Point", coordinates: [100, 100] },
        footprint: rectangle([50, 50, 300, 300]),
        attributes: {},
        relations: [],
        protected: true,
      },
    })
  ).candidate;
  const before = readFeature(world.id, id, areaId);
  const command = makeCommand(initial, "putFeature", {
    areaId,
    feature: { ...before, footprint: rectangle([50, 50, 400, 400]) },
  });
  commitCommand(world.id, command);
  expect(readFeature(world.id, id, areaId).geometry).toEqual(before.geometry);
  expect(readFeature(world.id, id, areaId).footprint).not.toEqual(before.footprint);
  const exported = exportWorld(world.id);
  expect(exported.features).toHaveLength(1);
  expect(exported.features[0].properties.footprint).toEqual(
    readFeature(world.id, id, areaId).footprint
  );
  undoWorld(world.id, command.operationId);
  expect(readFeature(world.id, id, areaId).footprint).toEqual(before.footprint);
  const current = session(world.id).snapshot.world;
  expect(() =>
    commitCommand(
      world.id,
      makeCommand(current, "putFeature", {
        areaId,
        feature: { ...before, footprint: rectangle([-20, 0, 30, 30]) },
      })
    )
  ).toThrow("footprint");
});
