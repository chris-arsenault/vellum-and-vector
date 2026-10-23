import { expect, it } from "vitest";
import { canonryMagicPresets, magicSurfaceCode, magicSystemSchema } from "@atlas/domain";
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
  map.HeatSourceDensity[0] = 1000;
  for (let i = 0; i < map.mesh.count; i++) {
    map.Temperature[i] = Math.round(300 + map.mesh.x[i] * 0.0005);
    map.Elevation[i] = Math.round(map.mesh.x[i] * 0.01 * 1024);
    map.WaterKindCodes[i] = map.mesh.x[i] < 0 ? 1 : 0;
    map.WaterDepths[i] = Math.max(0, -map.Elevation[i]);
    map.IceThickness[i] = map.Temperature[i] < 300 ? 400 : 0;
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
  const origins = (state: ReturnType<typeof scenario>) => state.physical!.magic!.fields[2].origins;
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
  expect(field.source.some((value) => value > 0)).toBe(true);
  expect(field.intensity.filter((value) => value > 0).length).toBeGreaterThan(1);
  const original = map.Temperature.slice(),
    ice = map.IceThickness.slice();
  magicThermalFeedback(state);
  magicRockFeedback(state);
  expect(map.Temperature.some((value, i) => value > original[i])).toBe(true);
  expect(map.IceThickness.some((value, i) => value < ice[i])).toBe(true);
  expect(map.RockResistance.some((value) => value > 1000)).toBe(true);
  const warm = map.Temperature.slice();
  magicThermalFeedback(state);
  expect(map.Temperature).toEqual(warm);
  field.definition.parameters.baseCost = 1_000_000;
  propagateMagic(state, field, 42, 1);
  expect(field.intensity.filter((value) => value > 0).length).toBe(
    field.source.filter((value) => value > 0).length
  );
});
it("routes cold accumulation into ice and weakens the material that later erosion consumes", () => {
  const state = scenario(),
    map = state.physical!.map,
    field = state.physical!.magic!.fields[1];
  locateMagicSources(state, field, 42);
  propagateMagic(state, field, 42, 1);
  expect(field.retained.some((value) => value > 0)).toBe(true);
  expect(field.intensity.some((value) => value > 0)).toBe(true);
  magicRockFeedback(state);
  expect(map.RockResistance.some((value) => value < 1000)).toBe(true);
  propagateMagic(state, field, 42, 0);
  expect(field.intensity.every((value) => value === 0)).toBe(true);
});
it("keeps pressure rays in oceans, forces coasts and advects old activity onto uplifted land", () => {
  const state = scenario(),
    map = state.physical!.map,
    field = state.physical!.magic!.fields[2];
  locateMagicSources(state, field, 42);
  propagateMagic(state, field, 42, 1);
  expect(field.source.filter((value) => value > 0)).toHaveLength(1);
  expect(field.intensity.some((value) => value > 0)).toBe(true);
  expect(field.intensity.every((value, i) => !value || map.WaterKindCodes[i] === 1)).toBe(true);
  expect(field.wake.some((value) => value > 0)).toBe(true);
  magicCoastalFeedback(state);
  expect(map.ExternalCoastalForcing.some((value) => value > 0)).toBe(true);
  field.history.set(field.intensity);
  field.firstEpoch.fill(0);
  const oldOcean = field.intensity.findIndex((value) => value > 0);
  const land = map.WaterKindCodes.findIndex((value) => value === 0);
  map.AdvectionSourceIndex.fill(-1);
  map.AdvectionSourceIndex[land] = oldOcean;
  const activity = field.history[oldOcean];
  advectMagic(state);
  expect(field.history[land]).toBe(activity);
  expect(field.firstEpoch[land]).toBe(0);
  expect(field.intensity[land]).toBe(0);
});
it("classifies nonexclusive interactions from editable conditions on multiple systems", () => {
  const state = scenario(),
    magic = state.physical!.magic!;
  for (const field of magic.fields) field.intensity.fill(500);
  classifyMagicFeatures(state, 42);
  const pressure = magic.fields[2];
  expect(pressure.features.war.every((value) => value === 1)).toBe(true);
  expect(pressure.features.steam.some((value) => value === 1)).toBe(true);
  pressure.definition.features.find((rule) => rule.id === "war")!.seeds[0][0].min = 700;
  classifyMagicFeatures(state, 42);
  expect(pressure.features.war.every((value) => value === 0)).toBe(true);
  expect(pressure.features.steam.some((value) => value === 1)).toBe(true);
});
it("writes final-surface codes that the shared surface catalogue names", () => {
  const state = scenario(),
    magic = state.physical!.magic!;
  for (const field of magic.fields) field.intensity.fill(500);
  classifyMagicFeatures(state, 42);
  const systems = magic.fields.map((field) => field.definition);
  const catalogue = new Set(
    systems.flatMap((system) =>
      system.features.map((rule) => magicSurfaceCode(systems, system.id, rule.id))
    )
  );
  expect(magic.finalSurface.every((code) => code < 100 || catalogue.has(code))).toBe(true);
  // Steam fracture (priority 110) owns its cells unless the higher-priority breach also matches.
  const steam = magicSurfaceCode(systems, "pressure", "steam")!,
    { steam: cells, breach } = magic.fields[2].features;
  expect(cells.some((value, i) => value === 1 && !breach[i])).toBe(true);
  for (let i = 0; i < cells.length; i++)
    if (cells[i] && !breach[i]) expect(magic.finalSurface[i]).toBe(steam);
});
