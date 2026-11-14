import { expect, it } from "vitest";
import { residentBand } from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { createTestField } from "../rock/groundTestFixture";
import { createMesh } from "./mesh";
import { atlasPhysicalProfile } from "./atlasProfile";
import { projectedMagicValues } from "./magicFeatures";
import { magicEffectChannels, societyChannels } from "./magicFieldDefinitions";

it("publishes effects and society amounts under their physical identifiers", () => {
  expect(magicEffectChannels).toContain("Quickening");
  expect(magicEffectChannels).toContain("FogForcing");
  expect(societyChannels).toContainEqual(["Tenure", "person-year", "site-amount"]);
  expect(societyChannels).toContainEqual(["KeptLine", "year", "extensive"]);
});

it("resamples a supplied magic amount even when projection uses a single donor", () => {
  const state = landscape(),
    map = createTestField(createMesh(4, 0)),
    donor = Array.from({ length: map.mesh.count }, (_, cell) => cell).find(
      (cell) => map.mesh.area(cell) > 0
    )!;
  state.physical = {
    map,
    profile: atlasPhysicalProfile({}, {}, map.scale),
    grid: state.surface.coverage,
    samples: residentBand("int32", new Int32Array(state.surface.active.length).fill(donor)),
    fixed: [],
    inherited: false,
  };
  const amount = { get: () => 7 * map.mesh.area(donor) },
    projected = projectedMagicValues(state, amount, "extensive");
  expect(projected.get(0)).toBe(7 * state.surface.measures.get(0));
  const intensity = projectedMagicValues(state, { get: () => 320 }, "intensive");
  expect(intensity.get(0)).toBe(320);
});
