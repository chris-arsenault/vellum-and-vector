import { expect, it } from "vitest";
import { canonryMagicPresets, putChannel, residentBand } from "@atlas/domain";
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
    residentBand(
      "float64",
      Float64Array.from(surface.measures, (area) => area * 3)
    ),
    "extensive"
  );
  putChannel(
    surface,
    "magic:fire:origin:vein:source",
    "relative-intensity",
    residentBand("float64", new Float64Array(10).fill(750))
  );
  putChannel(
    surface,
    "magic:fire:firstEpoch",
    "category",
    residentBand("float64", new Float64Array(10).fill(2)),
    "category"
  );
  const before = Array.from(surface.channels["magic:fire:stock:vein/held"]);
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
    samples: residentBand("int32", new Int32Array(10)),
    grid: surface.coverage,
    fixed: [],
    inherited: true,
    sampling: { maximumSize: 250, minimumSize: 250, featureSamples: 2 },
  };
  initializeMagic(state);
  const fire = state.physical.magic!.fields.find((field) => field.definition.id === "fire")!;
  const mesh = map.mesh,
    content: number[] = [];
  for (let i = 0; i < mesh.count; i++) if (mesh.membership(i) === 1) content.push(i);
  expect(Array.from(fire.stocks["vein/held"]).reduce((sum, amount) => sum + amount, 0)).toBeCloseTo(
    12_000_000,
    5
  );
  expect(content.every((i) => fire.originSources.vein.get(i) === 750)).toBe(true);
  expect(content.every((i) => fire.firstEpoch.get(i) === 2)).toBe(true);
  expect(Array.from(surface.channels["magic:fire:stock:vein/held"])).toEqual(before);
  expect(fire.lost).toBe(0);
});
