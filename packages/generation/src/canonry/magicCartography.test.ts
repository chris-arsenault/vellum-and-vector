import { expect, it } from "vitest";
import { canonryMagicPresets, type MagicSystem } from "@atlas/domain";
import { magicCartography } from "../magicCartography";
import { applyCartographicSelection } from "../cartographicControls";
import { landscape } from "../mapFixtures";
import { createWorldMesh } from "./worldMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { initializeMagic } from "./magicState";
import { locateMagicSources } from "./magicSources";
import { propagateMagic } from "./magicPropagation";
import { magicRockFeedback, magicThermalFeedback, magicCoastalFeedback } from "./magicFeedback";

function outcome(id: string, index: number) {
  const control = magicCartography.find((entry) => entry.id === id)!;
  const selected = applyCartographicSelection(
    { "magic.configured": { configuration: { magicSystems: canonryMagicPresets() as never } } },
    control.choices[index]
  );
  return selected["magic.configured"].configuration!.magicSystems as unknown as MagicSystem[];
}
function scenario(id: string, index: number) {
  const state = landscape();
  const map = createField(createWorldMesh([0, 0, 4_000_000, 2_000_000], 2048, 0));
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    samples: new Int32Array(state.surface.active.length),
    fixed: [],
    inherited: false,
    sampling: { maximumSize: map.mesh.spacing, minimumSize: map.mesh.spacing, featureSamples: 2 },
  };
  for (let i = 0; i < map.mesh.count; i++) {
    map.FractureConductance[i] = 900;
    map.RockResistance[i] = 1500;
    map.Temperature[i] = 180 + map.mesh.x[i] / 15_000;
    map.IceThickness[i] = 400;
    map.WaterKindCodes[i] = Number(map.mesh.x[i] < 0);
    map.WaterDepths[i] = map.WaterKindCodes[i] * 2_000_000;
    map.HeatSourceDensity[i] = Math.round(
      (500 + 400 * Math.cos(map.mesh.x[i] / 140_000) * Math.cos(map.mesh.y[i] / 140_000)) *
        (0.5 + map.mesh.y[i] / 4_000_000)
    );
  }
  initializeMagic(state, true, outcome(id, index));
  return state;
}

it("changes Fire core distribution, thermal footprint, thaw and resistant terrain through their own mappings", () => {
  const counts: number[] = [],
    reaches: number[] = [],
    heat: number[] = [],
    rock: number[] = [];
  for (const index of [0, 2]) {
    const cores = scenario("fire.cores", index),
      field = cores.physical!.magic!.fields[0];
    locateMagicSources(cores, field, 73);
    counts.push(field.located.length);
    const reach = scenario("fire.reach", index),
      fire = reach.physical!.magic!.fields[0];
    fire.source[Math.floor(fire.source.length / 2)] = 1000;
    propagateMagic(reach, fire, 73, 1);
    reaches.push(fire.intensity.filter((value) => value > 0).length);
    const thermal = scenario("fire.thaw", index);
    thermal.physical!.magic!.fields[0].intensity.fill(500);
    magicThermalFeedback(thermal);
    heat.push(thermal.physical!.magic!.heat[0]);
    const terrain = scenario("fire.hardening", index);
    terrain.physical!.magic!.fields[0].intensity.fill(500);
    magicRockFeedback(terrain);
    rock.push(terrain.physical!.map.RockResistance[0]);
  }
  expect(counts[1]).toBeGreaterThan(counts[0]);
  expect(reaches[1]).toBeGreaterThan(reaches[0]);
  expect(heat[1]).toBeGreaterThan(heat[0]);
  expect(rock[1]).toBeGreaterThan(rock[0]);
});

it("changes Aurora's source envelope, ice capture and rock response without inventing warmth or fertility", () => {
  const sources: number[] = [],
    capture: number[] = [],
    rock: number[] = [];
  for (const index of [0, 2]) {
    const input = scenario("aurora.terrain", index),
      field = input.physical!.magic!.fields[1];
    locateMagicSources(input, field, 73);
    sources.push(field.source.filter((value) => value > 0).length);
    const ice = scenario("aurora.capture", index),
      aurora = ice.physical!.magic!.fields[1];
    locateMagicSources(ice, aurora, 73);
    propagateMagic(ice, aurora, 73, 1);
    capture.push(aurora.retained.reduce((sum, value) => sum + value, 0));
    const terrain = scenario("aurora.softening", index);
    terrain.physical!.magic!.fields[1].intensity.fill(500);
    magicRockFeedback(terrain);
    rock.push(terrain.physical!.map.RockResistance[0]);
    // Aurora's stillness cools and slows; no control may turn it into warmth or growth.
    expect(aurora.definition.effects.heat).toBeLessThanOrEqual(0);
    expect(aurora.definition.effects.vegetationGrowth).toBeLessThanOrEqual(0);
  }
  expect(sources[1]).toBeGreaterThan(sources[0]);
  expect(capture[1]).toBeLessThan(capture[0]);
  expect(rock[1]).toBeLessThan(rock[0]);
});

it("changes Pressure travel, coastal stress and historical impulses while keeping its deep locus and angular resolution", () => {
  const reach: number[] = [],
    stress: number[] = [],
    rogues: number[] = [],
    wakes: number[] = [];
  for (const index of [0, 2]) {
    const ocean = scenario("pressure.extent", index),
      field = ocean.physical!.magic!.fields[2];
    locateMagicSources(ocean, field, 73);
    propagateMagic(ocean, field, 73, 1);
    expect(field.located).toHaveLength(1);
    expect(field.definition.parameters.rayCount).toBe(canonryMagicPresets()[2].parameters.rayCount);
    reach.push(field.intensity.reduce((sum, value) => sum + value, 0));
    const coast = scenario("pressure.stress", index);
    coast.physical!.magic!.fields[2].intensity.fill(300);
    magicCoastalFeedback(coast);
    stress.push(coast.physical!.magic!.coastal.reduce((sum, value) => sum + value, 0));
    const rogue = scenario("pressure.rogues", index),
      impulse = rogue.physical!.magic!.fields[2];
    propagateMagic(rogue, impulse, 73, 1);
    rogues.push(impulse.rogue.reduce((sum, value) => sum + value, 0));
    const wake = scenario("pressure.wakes", index),
      history = wake.physical!.magic!.fields[2];
    // Isolate wake contributions from standing rays and rogue impulses.
    history.definition.parameters.coastalSources = 0;
    history.definition.parameters.rayCount = 0;
    propagateMagic(wake, history, 73, 1);
    wakes.push(history.intensity.reduce((sum, value) => sum + value, 0));
  }
  expect(reach[1]).toBeGreaterThan(reach[0]);
  expect(stress[1]).toBeGreaterThan(stress[0]);
  expect(rogues[1]).toBeGreaterThan(rogues[0]);
  expect(wakes[1]).toBeGreaterThan(wakes[0]);
});
