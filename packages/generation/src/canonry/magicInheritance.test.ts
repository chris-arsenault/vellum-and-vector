import { expect, it } from "vitest";
import { canonryMagicPresets, putChannel } from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { createField } from "./field";
import { createAdaptiveWorldMesh } from "./adaptiveMesh";
import { atlasPhysicalProfile } from "./atlasProfile";
import { initializeMagic } from "./magicState";

it("inherits material amounts by receiving area and retains origin strengths and occurrence history", () => {
  const state = landscape(),
    surface = state.surface;
  state.domain.world.magicSystems = canonryMagicPresets();
  putChannel(
    surface,
    "magic:fire:stock:vein/held",
    "intensity-square-metre",
    Float64Array.from(surface.measures, (area) => area * 3),
    "extensive"
  );
  putChannel(
    surface,
    "magic:fire:origin:vein:source",
    "relative-intensity",
    new Float64Array(10).fill(750)
  );
  putChannel(
    surface,
    "magic:fire:firstEpoch",
    "category",
    new Float64Array(10).fill(2),
    "category"
  );
  const before = surface.channels["magic:fire:stock:vein/held"].slice();
  const map = createField(
    createAdaptiveWorldMesh(
      surface.bounds,
      { maximumSize: 250, minimumSize: 250, refine: () => false },
      0
    )
  );
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    samples: new Int32Array(10),
    fixed: [],
    inherited: true,
    sampling: { maximumSize: 250, minimumSize: 250, featureSamples: 2 },
  };
  initializeMagic(state);
  const fire = state.physical.magic!.fields.find((field) => field.definition.id === "fire")!;
  expect(fire.stocks["vein/held"].reduce((sum, amount) => sum + amount, 0)).toBeCloseTo(
    12_000_000,
    5
  );
  expect(fire.originSources.vein.every((strength) => strength === 750)).toBe(true);
  expect(fire.firstEpoch.every((epoch) => epoch === 2)).toBe(true);
  expect(surface.channels["magic:fire:stock:vein/held"]).toEqual(before);
  expect(fire.lost).toBe(0);
});
