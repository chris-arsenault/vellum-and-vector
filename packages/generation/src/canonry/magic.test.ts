import { expect, it } from "vitest";
import {
  canonryMagicPresets,
  magicSurfaceCode,
  magicSystemSchema,
  surfaceRuleSources,
} from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { createAdaptiveWorldMesh } from "./adaptiveMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { initializeMagic, advectMagic } from "./magicState";
import { locateMagicSources } from "./magicSources";
import { propagateMagic } from "./magicPropagation";
import { magicThermalFeedback, magicRockFeedback, magicCoastalFeedback } from "./magicFeedback";
import { classifyMagicFeatures } from "./magicFeatures";

function scenario() {
  const state = landscape(),
    map = createField(
      createAdaptiveWorldMesh(
        [-100_000, -100_000, 100_000, 100_000],
        {
          maximumSize: 25_000,
          minimumSize: 6250,
          refine: ([x, , right]) => x < 25_000 && right > -25_000,
        },
        0
      )
    );
  state.domain.world.magicSystems = canonryMagicPresets();
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    samples: new Int32Array(state.surface.active.length),
    fixed: [],
    inherited: false,
    sampling: { maximumSize: map.mesh.spacing, minimumSize: map.mesh.spacing, featureSamples: 2 },
  };
  map.RockResistance.fill(1000);
  map.FractureConductance.fill(800);
  map.HeatSourceDensity.set(0, 1000);
  for (let i = 0; i < map.mesh.count; i++) {
    map.Temperature.set(i, Math.round(300 + map.mesh.x(i) * 0.0005));
    map.Elevation.set(i, Math.round(map.mesh.x(i) * 0.01 * 1024));
    map.WaterKindCodes.set(i, map.mesh.x(i) < 0 ? 1 : 0);
    map.WaterDepths.set(i, Math.max(0, -map.Elevation.get(i)));
    map.IceThickness.set(i, map.Temperature.get(i) < 300 ? 400 : 0);
  }
  initializeMagic(state);
  return state;
}
it("places deep-ocean sources from the requested seed independently of source-world seed", () => {
  const first = scenario(),
    second = scenario();
  second.domain.world.seed = 99999;
  for (const state of [first, second])
    locateMagicSources(state, state.physical!.magic!.fields[2], 73);
  const origins = (state: ReturnType<typeof scenario>) => state.physical!.magic!.fields[2].located;
  expect(origins(first)).toHaveLength(1);
  expect(origins(first)).toEqual(origins(second));
});
it("uses configurable fracture transport, heating, melting and rock hardening without preset identity checks", () => {
  const state = scenario(),
    map = state.physical!.map,
    field = state.physical!.magic!.fields[0];
  field.definition = magicSystemSchema.parse({
    ...field.definition,
    id: "a-new-system",
    name: "Altered example",
  });
  locateMagicSources(state, field, 42);
  propagateMagic(state, field, 42, 1);
  expect(Array.from(field.source).some((value) => value > 0)).toBe(true);
  expect(Array.from(field.intensity).filter((value) => value > 0).length).toBeGreaterThan(1);
  const original = Array.from(map.Temperature),
    ice = Array.from(map.IceThickness);
  magicThermalFeedback(state);
  magicRockFeedback(state);
  expect(Array.from(map.Temperature).some((value, i) => value > original[i])).toBe(true);
  expect(Array.from(map.IceThickness).some((value, i) => value < ice[i])).toBe(true);
  expect(Array.from(map.RockResistance).some((value) => value > 1000)).toBe(true);
  const warm = Array.from(map.Temperature);
  magicThermalFeedback(state);
  expect(Array.from(map.Temperature)).toEqual(warm);
  field.definition.parameters.baseCost = 1_000_000;
  propagateMagic(state, field, 42, 1);
  expect(Array.from(field.intensity).filter((value) => value > 0).length).toBe(
    Array.from(field.source).filter((value) => value > 0).length
  );
});
it("routes cold accumulation into ice and weakens the material that later erosion consumes", () => {
  const state = scenario(),
    map = state.physical!.map,
    field = state.physical!.magic!.fields[1];
  locateMagicSources(state, field, 42);
  propagateMagic(state, field, 42, 1);
  expect(Array.from(field.retained).some((value) => value > 0)).toBe(true);
  expect(Array.from(field.intensity).some((value) => value > 0)).toBe(true);
  magicRockFeedback(state);
  expect(Array.from(map.RockResistance).some((value) => value < 1000)).toBe(true);
  propagateMagic(state, field, 42, 0);
  expect(Array.from(field.intensity).every((value) => value === 0)).toBe(true);
});
it("keeps pressure rays in oceans, forces coasts and advects old activity onto uplifted land", () => {
  const state = scenario(),
    map = state.physical!.map,
    field = state.physical!.magic!.fields[2];
  locateMagicSources(state, field, 42);
  propagateMagic(state, field, 42, 1);
  expect(Array.from(field.source).filter((value) => value > 0)).toHaveLength(1);
  expect(Array.from(field.intensity).some((value) => value > 0)).toBe(true);
  expect(
    Array.from(field.intensity).every((value, i) => !value || map.WaterKindCodes.get(i) === 1)
  ).toBe(true);
  expect(Array.from(field.wake).some((value) => value > 0)).toBe(true);
  magicCoastalFeedback(state);
  expect(Array.from(map.ExternalCoastalForcing).some((value) => value > 0)).toBe(true);
  field.history.copyFrom(field.intensity);
  field.firstEpoch.fill(0);
  const oldOcean = Array.from(field.intensity).findIndex((value) => value > 0);
  const land = Array.from(map.WaterKindCodes).findIndex((value) => value === 0);
  map.AdvectionSourceIndex.fill(-1);
  map.AdvectionSourceIndex.set(land, oldOcean);
  const activity = field.history.get(oldOcean);
  advectMagic(state);
  expect(field.history.get(land)).toBe(activity);
  expect(field.firstEpoch.get(land)).toBe(0);
  expect(field.intensity.get(land)).toBe(0);
});
it("classifies nonexclusive interactions from editable conditions on multiple systems", () => {
  const state = scenario(),
    magic = state.physical!.magic!;
  for (const field of magic.fields) field.intensity.fill(500);
  classifyMagicFeatures(state, 42);
  const held = () => magic.confluences.states,
    [fire, aurora] = magic.fields;
  // The rim holds where both conditions pass and both parents have a class to give up.
  expect(Array.from(held().war.members).some((value) => value === 1)).toBe(true);
  for (let i = 0; i < held().war.members.length; i++)
    if (held().war.members.get(i)) {
      expect(fire.systemCoverage.get(i)).toBeGreaterThan(0);
      expect(aurora.systemCoverage.get(i)).toBeGreaterThan(0);
    }
  expect(Array.from(held().steam.members).some((value) => value === 1)).toBe(true);
  magic.confluences.definitions.find((rule) => rule.id === "war")!.seeds[0][0].min = 700;
  classifyMagicFeatures(state, 42);
  expect(Array.from(held().war.members).every((value) => value === 0)).toBe(true);
  expect(Array.from(held().steam.members).some((value) => value === 1)).toBe(true);
});
it("writes final-surface codes that the shared surface catalogue names", () => {
  const state = scenario(),
    magic = state.physical!.magic!;
  for (const field of magic.fields) field.intensity.fill(500);
  classifyMagicFeatures(state, 42);
  const sources = surfaceRuleSources(
    magic.fields.map((field) => field.definition),
    magic.confluences.definitions
  );
  const catalogue = new Set(
    sources.flatMap((system) =>
      system.features.map((rule) => magicSurfaceCode(sources, system.id, rule.id))
    )
  );
  expect(Array.from(magic.finalSurface).every((code) => code < 100 || catalogue.has(code))).toBe(
    true
  );
  // The largest coverage takes the cell and the next holds the second code: where Boiling
  // shore holds a fifth of a cell it is drawn as one or the other.
  const steam = magicSurfaceCode(sources, "confluence", "steam")!,
    { members: cells, coverage } = magic.confluences.states.steam;
  expect(Array.from(cells).some(Boolean)).toBe(true);
  for (let i = 0; i < cells.length; i++) {
    if (!cells.get(i) || coverage.get(i) < 0.2) continue;
    expect([magic.finalSurface.get(i), magic.secondSurface.get(i)]).toContain(steam);
  }
  // Every class present in a cell is a share of it, and the drawn code is one of them.
  for (let i = 0; i < cells.length; i++)
    if (cells.get(i) && coverage.get(i) > 0)
      expect(magic.finalSurface.get(i)).toBeGreaterThanOrEqual(100);
});
