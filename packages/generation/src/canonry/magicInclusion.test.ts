import { expect, it } from "vitest";
import { canonryMagicPresets } from "@atlas/domain";
import { landscape } from "../mapFixtures";
import type { MapProcessContext } from "../process";
import { createWorldMesh } from "./worldMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { initializeMagic, advectMagic } from "./magicState";
import { locateMagicSources } from "./magicSources";
import { propagateMagic } from "./magicPropagation";
import {
  magicThermalFeedback,
  magicRockFeedback,
  magicCoastalFeedback,
  retainMagicHistory,
} from "./magicFeedback";
import { classifyMagicFeatures, projectMagic } from "./magicFeatures";
import { magicChannels, magicFieldDefinitions } from "./magicFieldDefinitions";

function scenario(mask: number) {
  const state = landscape();
  const map = createField(createWorldMesh([0, 0, 200_000, 100_000], 128, 0));
  state.domain.world.magicSystems = canonryMagicPresets().map((system, i) => ({
    ...system,
    enabled: Boolean(mask & (1 << i)),
  }));
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    samples: new Int32Array(state.surface.active.length),
    fixed: [],
    inherited: false,
    sampling: { maximumSize: map.mesh.spacing, minimumSize: map.mesh.spacing, featureSamples: 2 },
  };
  map.FractureConductance.fill(900);
  map.HeatSourceDensity[0] = 1000;
  map.RockResistance.fill(1200);
  map.IceThickness.fill(400);
  map.WaveExposure.fill(500);
  map.OceanCurrentStrength.fill(300);
  for (let i = 0; i < map.mesh.count; i++) {
    map.WaterKindCodes[i] = Number(map.mesh.x[i] < 0);
    map.WaterDepths[i] = map.WaterKindCodes[i] * 2_000_000;
    map.Temperature[i] = 200 + map.mesh.x[i] / 20_000;
  }
  initializeMagic(state);
  return state;
}
const context = { epochIndices: [0], recordCause() {} } as unknown as MapProcessContext;

for (let mask = 0; mask < 8; mask++) {
  it(`executes magic inclusion ${mask} with neutral absence and natural geography intact`, () => {
    const state = scenario(mask),
      map = state.physical!.map,
      magic = state.physical!.magic!;
    const water = map.WaterKindCodes.slice(),
      current = map.OceanCurrentStrength.slice(),
      geothermal = map.HeatSourceDensity.slice();
    for (const field of magic.fields) {
      field.definition.parameters.coastalThreshold = 0;
      field.definition.history.storage = 0.5;
      locateMagicSources(state, field, 73);
      propagateMagic(state, field, 73, 1);
      expect(field.intensity.some((value) => value > 0)).toBe(field.definition.enabled);
    }
    magicThermalFeedback(state);
    magicRockFeedback(state);
    magicCoastalFeedback(state);
    retainMagicHistory(state, context);
    classifyMagicFeatures(state);
    projectMagic(state);
    for (const field of magic.fields) {
      for (const channel of magicChannels) expect(field[channel].every(Number.isFinite)).toBe(true);
      if (field.definition.enabled) continue;
      for (const channel of magicChannels)
        expect(
          field[channel].every((value) => value === magicFieldDefinitions[channel].initial),
          `${field.definition.id}:${channel}`
        ).toBe(true);
      for (const [id, values] of Object.entries(field.features))
        if (id !== "war") expect(values.every((value) => value === 0)).toBe(true);
    }
    expect(map.WaterKindCodes).toEqual(water);
    expect(map.OceanCurrentStrength).toEqual(current);
    expect(map.HeatSourceDensity).toEqual(geothermal);
    if (mask === 0) {
      expect(map.ExternalHeatForcing.every((value) => value === 0)).toBe(true);
      expect(map.ExternalCoastalForcing.every((value) => value === 0)).toBe(true);
      expect(map.RockResistance.every((value) => value === 1200)).toBe(true);
      expect(magic.finalSurface).toEqual(magic.naturalSurface);
    }
  });
}

it("rejects stale active forcing from disabled contributors, including zero-threshold coastal amplification", () => {
  const state = scenario(0),
    map = state.physical!.map;
  const temperature = map.Temperature.slice(),
    ice = map.IceThickness.slice();
  expect(map.WaterKindCodes.some((value) => value === 0)).toBe(true);
  expect(map.WaterKindCodes.some((value) => value === 1)).toBe(true);
  for (const field of state.physical!.magic!.fields) {
    field.intensity.fill(800);
    field.source.fill(1000);
    field.definition.parameters.coastalThreshold = 0;
  }
  magicThermalFeedback(state);
  magicRockFeedback(state);
  magicCoastalFeedback(state);
  retainMagicHistory(state, context);
  expect(map.Temperature).toEqual(temperature);
  expect(map.IceThickness).toEqual(ice);
  expect(map.ExternalCoastalForcing.every((value) => value === 0)).toBe(true);
  expect(map.RockResistance.every((value) => value === 1200)).toBe(true);
  for (const field of state.physical!.magic!.fields) {
    field.stored.fill(600);
    propagateMagic(state, field, 73, 1);
    expect(field.intensity.every((value) => value === 0)).toBe(true);
    expect(field.stored.every((value) => value === 0)).toBe(true);
  }
  map.AdvectionSourceIndex.fill(0);
  advectMagic(state);
});

it("lets Aurora respond to the changed heat and ice when Fire is omitted", () => {
  const outcomes = [2, 3].map((mask) => {
    const state = scenario(mask),
      fields = state.physical!.magic!.fields;
    locateMagicSources(state, fields[0], 73);
    propagateMagic(state, fields[0], 73, 1);
    magicThermalFeedback(state);
    locateMagicSources(state, fields[1], 73);
    propagateMagic(state, fields[1], 73, 1);
    return {
      ice: state.physical!.map.IceThickness.reduce((sum, value) => sum + value, 0),
      source: fields[1].source.reduce((sum, value) => sum + value, 0),
    };
  });
  expect(outcomes[0].ice).toBeGreaterThan(outcomes[1].ice);
  expect(outcomes[0].source).toBeGreaterThan(outcomes[1].source);
});

it("retains Fire/Aurora contact with Pressure absent and requires the actual participants", () => {
  for (let mask = 0; mask < 8; mask++) {
    const state = scenario(mask),
      fields = state.physical!.magic!.fields;
    // Controlled overlap isolates participation from geography and distribution.
    for (const field of fields) field.intensity.fill(500);
    classifyMagicFeatures(state);
    expect(fields[2].features.war.every((value) => value === Number((mask & 3) === 3))).toBe(true);
    if (!(mask & 4)) expect(fields[2].features.steam).toBeUndefined();
    fields[2].definition.features = [
      {
        id: "zero",
        name: "Zero boundary",
        priority: 100,
        seeds: [[{ field: "system:fire", max: 0 }]],
      },
    ];
    fields[0].definition.enabled = false;
    fields[0].intensity.fill(0);
    classifyMagicFeatures(state);
    expect(fields[2].features.zero.every((value) => value === 0)).toBe(true);
  }
});
