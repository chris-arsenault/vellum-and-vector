import { fixtureWorld, fixtureState, commitCommand } from "./testSupport/workspaceFixture";
import { expect, it } from "vitest";
import { makeCommand } from "./useAtlas";
import { rectangle } from "./presentation";

it("validates physical history and preserves it once a child has inherited its boundaries", async () => {
  const initial = fixtureWorld({ name: "History", seed: 9, width: 1000, height: 1000 }),
    epochs = initial.epochs.slice(0, 1);
  const history = (
    await commitCommand(initial.id, makeCommand(initial, "setPhysicalEpochs", { epochs }))
  ).candidate;
  expect(history.epochs).toEqual(epochs);
  await expect(
    async () =>
      await commitCommand(initial.id, makeCommand(history, "setPhysicalEpochs", { epochs: [] }))
  ).rejects.toThrow("at least one");
  await expect(
    async () =>
      await commitCommand(
        initial.id,
        makeCommand(history, "setPhysicalEpochs", { epochs: [{ ...epochs[0], ice: 2 }] })
      )
  ).rejects.toThrow("strengths");
  await expect(
    async () =>
      await commitCommand(
        initial.id,
        makeCommand(history, "setPhysicalEpochs", { epochs: [epochs[0], epochs[0]] })
      )
  ).rejects.toThrow("unique names");
  await expect(
    async () =>
      await commitCommand(
        initial.id,
        makeCommand(history, "setPhysicalEpochs", {
          epochs: [{ ...epochs[0], ecology: { seasonality: 2 } }],
        })
      )
  ).rejects.toThrow("finite climate");
  expect(fixtureState(initial.id).snapshot.world.version).toBe(history.version);
  const parentId = Object.keys(history.areas)[0];
  const child = (
    await commitCommand(
      initial.id,
      makeCommand(history, "createArea", {
        parentId,
        name: "Inherited",
        profile: "site",
        footprint: rectangle(100, 100, 100, 100),
        frame: { origin: { x: 100, y: 100, z: 0 }, rotation: 0, metresPerUnit: 1, floor: null },
        approach: "manual",
        traits: [],
      })
    )
  ).candidate;
  await expect(
    async () =>
      await commitCommand(
        initial.id,
        makeCommand(child, "setPhysicalEpochs", { epochs: initial.epochs })
      )
  ).rejects.toThrow("boundaries stay fixed");
  expect(fixtureState(initial.id).snapshot.world.epochs).toEqual(epochs);
});
