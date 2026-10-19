import { expect, it } from "vitest";
import { canonryMagicPresets, magicSystemSchema } from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { createWorldMesh } from "./worldMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { initializeMagic, advectMagic } from "./magicState";
import { locateMagicSources } from "./magicSources";
import { propagateMagic } from "./magicPropagation";
import { magicThermalFeedback, magicRockFeedback, magicCoastalFeedback } from "./magicFeedback";
import { classifyMagicFeatures } from "./magicFeatures";

function scenario() {
  const state = landscape(),
    map = createField(createWorldMesh([-100_000, -100_000, 100_000, 100_000], 256, 20_000));
  state.domain.world.magicSystems = canonryMagicPresets();
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    samples: new Int32Array(state.surface.active.length),
    fixed: [],
    inherited: false,
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
