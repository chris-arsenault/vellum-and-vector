import { expect, it } from "vitest";
import { createWorld, session } from "./atlasState";
import { commitCommand } from "./atlasCommands";
import { makeCommand } from "./useAtlas";
import { rectangle } from "./presentation";

it("validates physical history and preserves it once a child has inherited its boundaries", () => {
  const initial = createWorld({ name: "History", seed: 9, width: 1000, height: 1000 }),
    epochs = initial.epochs.slice(0, 1);
  const history = commitCommand(
    initial.id,
    makeCommand(initial, "setPhysicalEpochs", { epochs })
  ).candidate;
  expect(history.epochs).toEqual(epochs);
  expect(() =>
    commitCommand(initial.id, makeCommand(history, "setPhysicalEpochs", { epochs: [] }))
  ).toThrow("at least one");
  expect(() =>
    commitCommand(
      initial.id,
      makeCommand(history, "setPhysicalEpochs", { epochs: [{ ...epochs[0], ice: 2 }] })
    )
  ).toThrow("strengths");
  expect(() =>
    commitCommand(
      initial.id,
      makeCommand(history, "setPhysicalEpochs", { epochs: [epochs[0], epochs[0]] })
    )
  ).toThrow("unique names");
  expect(() =>
    commitCommand(
      initial.id,
      makeCommand(history, "setPhysicalEpochs", {
        epochs: [{ ...epochs[0], ecology: { seasonality: 2 } }],
      })
    )
  ).toThrow("finite climate");
  expect(session(initial.id).snapshot.world.version).toBe(history.version);
  const parentId = Object.keys(history.areas)[0];
  const child = commitCommand(
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
  ).candidate;
  expect(() =>
    commitCommand(initial.id, makeCommand(child, "setPhysicalEpochs", { epochs: initial.epochs }))
  ).toThrow("boundaries stay fixed");
  expect(session(initial.id).snapshot.world.epochs).toEqual(epochs);
});
