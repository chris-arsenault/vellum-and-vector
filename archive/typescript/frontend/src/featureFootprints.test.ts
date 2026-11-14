import {
  fixtureWorld,
  fixtureState,
  undoWorld,
  commitCommand,
  readFeature,
  exportWorld,
} from "./testSupport/workspaceFixture";
import { expect, it } from "vitest";
import { rectangle } from "@atlas/domain";
import { makeCommand } from "./useAtlas";

it("authors the footprint independently, retains source position, exports one identity and restores it on undo", async () => {
  const world = fixtureWorld({ name: "Footprints", seed: 1, width: 1000, height: 1000 }),
    areaId = Object.keys(world.areas)[0],
    id = crypto.randomUUID();
  const initial = (
    await commitCommand(
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
    )
  ).candidate;
  const before = await readFeature(world.id, id, areaId);
  const command = makeCommand(initial, "putFeature", {
    areaId,
    feature: { ...before, footprint: rectangle([50, 50, 400, 400]) },
  });
  await commitCommand(world.id, command);
  expect((await readFeature(world.id, id, areaId)).geometry).toEqual(before.geometry);
  expect((await readFeature(world.id, id, areaId)).footprint).not.toEqual(before.footprint);
  const exported = await exportWorld(world.id);
  expect(exported.features).toHaveLength(1);
  expect(exported.features[0].properties.footprint).toEqual(
    (await readFeature(world.id, id, areaId)).footprint
  );
  await undoWorld(world.id, command.operationId);
  expect((await readFeature(world.id, id, areaId)).footprint).toEqual(before.footprint);
  const current = fixtureState(world.id).snapshot.world;
  await expect(
    async () =>
      await commitCommand(
        world.id,
        makeCommand(current, "putFeature", {
          areaId,
          feature: { ...before, footprint: rectangle([-20, 0, 30, 30]) },
        })
      )
  ).rejects.toThrow("footprint");
});
