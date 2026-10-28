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
  map.HeatSourceDensity.set(contentCells(map)[0], 1000);
  map.RockResistance.fill(1200);
  map.IceThickness.fill(400);
  map.WaveExposure.fill(500);
  map.OceanCurrentStrength.fill(300);
  for (let i = 0; i < map.mesh.count; i++) {
    map.WaterKindCodes.set(i, Number(map.mesh.x(i) < 0));
    map.WaterDepths.set(i, map.WaterKindCodes.get(i) * 2_000_000);
    map.Temperature.set(i, 200 + map.mesh.x(i) / 20_000);
  }
  initializeMagic(state);
  return state;
}
/** Content cells in id order; content is not a prefix of the ids. */
function contentCells(map: ReturnType<typeof createField>) {
  const cells: number[] = [];
  for (let i = 0; i < map.mesh.count; i++) if (map.mesh.membership(i) === 1) cells.push(i);
  return cells;
}
const context = { epochIndices: [0], recordCause() {} } as unknown as MapProcessContext;

for (let mask = 0; mask < 8; mask++) {
  it(`executes magic inclusion ${mask} with neutral absence and natural geography intact`, () => {
    const state = scenario(mask),
      map = state.physical!.map,
      magic = state.physical!.magic!,
      cells = contentCells(map);
    const water = Array.from(map.WaterKindCodes),
      current = Array.from(map.OceanCurrentStrength),
      geothermal = Array.from(map.HeatSourceDensity);
    for (const field of magic.fields) {
      field.definition.parameters.coastalThreshold = 0;
      field.definition.history.storage = 0.5;
      locateMagicSources(state, field, 73);
      propagateMagic(state, field, 73, 1);
      expect(Array.from(field.intensity).some((value) => value > 0)).toBe(field.definition.enabled);
    }
    magicThermalFeedback(state);
    magicRockFeedback(state);
    magicCoastalFeedback(state);
    retainMagicHistory(state, context);
    classifyMagicFeatures(state);
    projectMagic(state);
    for (const field of magic.fields) {
      for (const channel of magicChannels)
        expect(Array.from(field[channel]).every(Number.isFinite)).toBe(true);
      if (field.definition.enabled) continue;
      for (const channel of magicChannels)
        expect(
          cells.every((i) => field[channel].get(i) === magicFieldDefinitions[channel].initial),
          `${field.definition.id}:${channel}`
        ).toBe(true);
      for (const [id, values] of Object.entries(field.features))
        if (id !== "war") expect(cells.every((i) => values.get(i) === 0)).toBe(true);
    }
    expect(Array.from(map.WaterKindCodes)).toEqual(water);
    expect(Array.from(map.OceanCurrentStrength)).toEqual(current);
    expect(Array.from(map.HeatSourceDensity)).toEqual(geothermal);
    if (mask === 0) {
      expect(cells.every((i) => map.ExternalHeatForcing.get(i) === 0)).toBe(true);
      expect(cells.every((i) => map.ExternalCoastalForcing.get(i) === 0)).toBe(true);
      expect(cells.every((i) => map.RockResistance.get(i) === 1200)).toBe(true);
      expect(Array.from(magic.finalSurface)).toEqual(Array.from(magic.naturalSurface));
    }
  });
}

it("rejects stale active forcing from disabled contributors, including zero-threshold coastal amplification", () => {
  const state = scenario(0),
    map = state.physical!.map,
    cells = contentCells(map);
  const temperature = Array.from(map.Temperature),
    ice = Array.from(map.IceThickness);
  expect(Array.from(map.WaterKindCodes).some((value) => value === 0)).toBe(true);
  expect(Array.from(map.WaterKindCodes).some((value) => value === 1)).toBe(true);
  for (const field of state.physical!.magic!.fields) {
    field.intensity.fill(800);
    field.source.fill(1000);
    field.definition.parameters.coastalThreshold = 0;
  }
  magicThermalFeedback(state);
  magicRockFeedback(state);
  magicCoastalFeedback(state);
  retainMagicHistory(state, context);
  expect(Array.from(map.Temperature)).toEqual(temperature);
  expect(Array.from(map.IceThickness)).toEqual(ice);
  expect(cells.every((i) => map.ExternalCoastalForcing.get(i) === 0)).toBe(true);
  expect(cells.every((i) => map.RockResistance.get(i) === 1200)).toBe(true);
  for (const field of state.physical!.magic!.fields) {
    field.stored.fill(600);
    propagateMagic(state, field, 73, 1);
    expect(cells.every((i) => field.intensity.get(i) === 0)).toBe(true);
    expect(cells.every((i) => field.stored.get(i) === 0)).toBe(true);
  }
  map.AdvectionSourceIndex.fill(0);
  advectMagic(state);
});

it("lets Aurora respond to the changed heat and ice when Fire is omitted", () => {
  const sum = (band: Iterable<number>) => {
    let total = 0;
    for (const value of band) total += value;
    return total;
  };
  const outcomes = [2, 3].map((mask) => {
    const state = scenario(mask),
      fields = state.physical!.magic!.fields;
    locateMagicSources(state, fields[0], 73);
    propagateMagic(state, fields[0], 73, 1);
    magicThermalFeedback(state);
    locateMagicSources(state, fields[1], 73);
    propagateMagic(state, fields[1], 73, 1);
    return {
      ice: sum(state.physical!.map.IceThickness),
      source: sum(fields[1].source),
    };
  });
  expect(outcomes[0].ice).toBeGreaterThan(outcomes[1].ice);
  expect(outcomes[0].source).toBeGreaterThan(outcomes[1].source);
});

it("retains Fire/Aurora contact with Pressure absent and requires the actual participants", () => {
  for (let mask = 0; mask < 8; mask++) {
    const state = scenario(mask),
      fields = state.physical!.magic!.fields,
      cells = contentCells(state.physical!.map);
    // Controlled overlap isolates participation from geography and distribution. The
    // meetings live in the shared confluence list and need every participant enabled.
    for (const field of fields) field.intensity.fill(500);
    classifyMagicFeatures(state);
    const held = state.physical!.magic!.confluences.states;
    if ((mask & 3) === 3) {
      expect(held.war).toBeDefined();
      expect(cells.every((i) => held.war.members.get(i) === 1)).toBe(true);
      expect(cells.every((i) => held.war.coverage.get(i) > 0)).toBe(true);
    } else expect(held.war).toBeUndefined();
    if (!(mask & 4)) {
      expect(held.steam).toBeUndefined();
      expect(held.breach).toBeUndefined();
    }
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
    expect(cells.every((i) => fields[2].features.zero.get(i) === 0)).toBe(true);
  }
});
