import { expect, it } from "vitest";
import { canonryConfluencePresets, canonryMagicPresets } from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { createAdaptiveWorldMesh } from "./adaptiveMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { initializeMagic } from "./magicState";
import { locateMagicSources } from "./magicSources";
import { propagateMagic } from "./magicPropagation";
import { classifyMagicFeatures, coverSystems } from "./magicFeatures";
import { evaluateConfluences } from "./magicConfluences";

function scenario() {
  const state = landscape(),
    map = createField(
      createAdaptiveWorldMesh(
        [-100_000, -100_000, 100_000, 100_000],
        { maximumSize: 25_000, minimumSize: 12_500, refine: () => true },
        0
      )
    );
  state.domain.world.magicSystems = canonryMagicPresets();
  state.domain.world.confluences = canonryConfluencePresets();
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    samples: new Int32Array(state.surface.active.length),
    fixed: [],
    inherited: false,
    sampling: { maximumSize: map.mesh.spacing, minimumSize: map.mesh.spacing, featureSamples: 2 },
  };
  map.RockResistance.fill(1000);
  map.FractureConductance.fill(500);
  map.SoilDepth.fill(2);
  map.SoilWater.fill(100);
  map.Temperature.fill(280);
  map.IceThickness.fill(300);
  map.WaterKindCodes.fill(0);
  initializeMagic(state);
  return state;
}
/** Fire on the west half, Aurora on the east, both strong in a band across the middle. */
function meet(state: ReturnType<typeof scenario>, sharp: boolean) {
  const map = state.physical!.map,
    [fire, aurora] = state.physical!.magic!.fields;
  for (let i = 0; i < map.mesh.count; i++) {
    const x = map.mesh.x[i];
    fire.intensity[i] = x < 30_000 ? 700 : sharp ? 0 : Math.max(0, 700 - (x - 30_000) / 100);
    aurora.intensity[i] = x > -30_000 ? 700 : sharp ? 0 : Math.max(0, 700 + (x + 30_000) / 100);
    map.FractureConductance[i] = 500;
  }
  // Give both systems a class whose coverage the meeting can take.
  fire.definition.features = [
    { id: "glow", name: "Glow", priority: 5, seeds: [[{ field: "intensity", min: 200 }]] },
  ];
  aurora.definition.features = [
    { id: "chill", name: "Chill", priority: 5, seeds: [[{ field: "intensity", min: 200 }]] },
  ];
}
it("keeps confluence coastal impulses on dry terrain", () => {
  const state = scenario(),
    map = state.physical!.map;
  meet(state, false);
  state.physical!.magic!.confluences.definitions.find(
    (entry) => entry.id === "war"
  )!.effects.coastalForcing = 900;
  for (let i = 0; i < map.mesh.count; i++) map.WaterKindCodes[i] = map.mesh.y[i] > 0 ? 1 : 0;
  coverSystems(state, 7);
  evaluateConfluences(state, 7, true);
  expect(map.ExternalCoastalForcing.some((value) => value > 0)).toBe(true);
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes[i] !== 0) expect(map.ExternalCoastalForcing[i]).toBe(0);
});
it("takes coverage from both parents where they meet, bounds the sum, and acts on the ground", () => {
  const state = scenario(),
    map = state.physical!.map,
    [fire, aurora] = state.physical!.magic!.fields;
  meet(state, false);
  const fracture = map.FractureConductance.slice(),
    rock = map.RockResistance.slice(),
    soil = map.SoilDepth.slice(),
    bedrock = map.BedrockElevation.slice(),
    meets = Array.from(fire.intensity, (value, i) => value >= 260 && aurora.intensity[i] >= 340);
  coverSystems(state, 7);
  evaluateConfluences(state, 7, true);
  const war = state.physical!.magic!.confluences.states.war;
  expect(war).toBeDefined();
  let covered = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    const total = fire.systemCoverage[i] + aurora.systemCoverage[i] + war.coverage[i];
    expect(total).toBeLessThanOrEqual(1 + 1e-9);
    if (meets[i]) {
      expect(war.members[i]).toBe(1);
      expect(war.coverage[i]).toBeGreaterThan(0);
      // The meeting displaces its parents rather than adding to them.
      expect(fire.systemCoverage[i]).toBeLessThan(1);
      expect(aurora.systemCoverage[i]).toBeLessThan(1);
      // Its own process: fractures opened, rock weakened, soil gone, bedrock roughened.
      expect(map.FractureConductance[i]).toBeGreaterThan(fracture[i]);
      expect(map.RockResistance[i]).toBeLessThan(rock[i]);
      expect(map.SoilDepth[i]).toBeLessThan(soil[i]);
      expect(map.BedrockElevation[i]).not.toBe(bedrock[i]);
      covered++;
    } else {
      expect(war.coverage[i]).toBe(0);
      expect(map.FractureConductance[i]).toBe(fracture[i]);
      expect(map.RockResistance[i]).toBe(rock[i]);
    }
  }
  expect(covered).toBeGreaterThan(0);
  // The cell's conditions are the meeting's, not the mean of a Fire-only and an Aurora-only
  // neighbour: those neighbours kept their rock and fractures, the rim did not.
  const rim = meets.indexOf(true);
  expect(rim).toBeGreaterThanOrEqual(0);
  expect(map.RockResistance[rim]).toBeLessThan(rock[rim]);
});

it("strains more across a sharp front than a gentle one", () => {
  const gentle = scenario(),
    sharp = scenario();
  meet(gentle, false);
  meet(sharp, true);
  for (const state of [gentle, sharp]) {
    coverSystems(state, 7);
    evaluateConfluences(state, 7, false);
  }
  const peak = (state: ReturnType<typeof scenario>) =>
    state.physical!.magic!.confluences.strain.reduce((a, b) => Math.max(a, b), 0);
  expect(peak(sharp)).toBeGreaterThan(peak(gentle));
  expect(peak(gentle)).toBeGreaterThan(0);
});

it("lets the next Fire propagation follow the fractures the rim opened", () => {
  const state = scenario(),
    map = state.physical!.map,
    [fire] = state.physical!.magic!.fields;
  map.HeatSourceDensity.fill(0);
  map.HeatSourceDensity[0] = 1000;
  locateMagicSources(state, fire, 42);
  propagateMagic(state, fire, 42, 1);
  const before = fire.intensity.filter((value) => value > 0).length;
  meet(state, false);
  coverSystems(state, 7);
  evaluateConfluences(state, 7, true);
  locateMagicSources(state, fire, 42);
  propagateMagic(state, fire, 42, 1);
  expect(fire.intensity.filter((value) => value > 0).length).toBeGreaterThanOrEqual(before);
  expect(map.FractureConductance.some((value) => value > 500)).toBe(true);
});

it("needs every participant enabled and leaves the other's fields whole", () => {
  const state = scenario(),
    [fire, aurora] = state.physical!.magic!.fields;
  meet(state, false);
  fire.definition.enabled = false;
  fire.intensity.fill(0);
  const auroraBefore = aurora.intensity.slice();
  classifyMagicFeatures(state, 7);
  expect(state.physical!.magic!.confluences.states.war).toBeUndefined();
  expect(aurora.intensity).toEqual(auroraBefore);
  expect(aurora.systemCoverage.some((value) => value > 0)).toBe(true);
});

it("maps a rule's declared coverage from floor to full and leaves undeclared rules whole", () => {
  const state = scenario(),
    [fire] = state.physical!.magic!.fields,
    map = state.physical!.map;
  fire.intensity.fill(0);
  fire.intensity[0] = 230;
  fire.intensity[1] = 515;
  fire.intensity[2] = 900;
  map.FractureConductance.fill(600);
  fire.definition.features = [
    {
      id: "vein",
      name: "Vein",
      priority: 1,
      seeds: [[{ field: "intensity", min: 230 }]],
      coverage: { field: "intensity", floor: 230, full: 800 },
    },
    { id: "whole", name: "Whole", priority: 1, seeds: [[{ field: "intensity", min: 230 }]] },
  ];
  coverSystems(state, 7);
  expect(fire.coverage.vein[0]).toBe(0);
  expect(fire.coverage.vein[1]).toBeCloseTo(0.5, 6);
  expect(fire.coverage.vein[2]).toBe(1);
  expect(fire.coverage.whole[0]).toBe(1);
  expect(fire.systemCoverage[0]).toBe(1);
});
