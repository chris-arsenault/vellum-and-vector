import { expect, it } from "vitest";
import { canonryMagicPresets } from "@atlas/domain";
import { landscape } from "../mapFixtures";
import type { MapProcessContext } from "../process";
import { createWorldMesh } from "./worldMesh";
import { createMesh } from "./mesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { advectMagic, initializeMagic } from "./magicState";
import { locateMagicSources } from "./magicSources";
import { propagateMagic } from "./magicPropagation";
import { magicCoastalFeedback, magicThermalFeedback } from "./magicFeedback";
import { classifyMagicFeatures, projectMagic } from "./magicFeatures";
import { Feature } from "./codes";

function scenario(samples = 4096) {
  const state = landscape();
  const map = createField(createWorldMesh([0, 0, 2_000_000, 1_000_000], samples, 0));
  state.domain.world.magicSystems = canonryMagicPresets();
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    samples: new Int32Array(state.surface.active.length),
    fixed: [],
    inherited: false,
  };
  initializeMagic(state);
  return state;
}

it("captures the same cold activity over a fixed physical travel distance", () => {
  const retained: number[] = [];
  for (const steps of [4, 8]) {
    const state = scenario(64),
      map = createField(createMesh(steps + 1, 0));
    state.physical!.map = map;
    map.mesh.spacing = 40_000 / steps;
    map.mesh.areas.fill(100_000_000);
    map.mesh.neighbors.fill(-1);
    map.mesh.edgeLength.fill(map.mesh.spacing);
    map.IceThickness.fill(400);
    for (let i = 0; i <= steps; i++) {
      map.Temperature[i] = 500 - i;
      if (i < steps) map.mesh.neighbors[i * 3] = i + 1;
      if (i > 0) map.mesh.neighbors[i * 3 + 1] = i - 1;
    }
    initializeMagic(state);
    const field = state.physical!.magic!.fields[1];
    field.source[0] = 100;
    propagateMagic(state, field, 42, 1);
    retained.push(field.retained.slice(0, steps).reduce((sum, value) => sum + value, 0));
  }
  expect(retained[0]).toBeCloseTo(10_000_000_000 * (1 - (2 / 3) ** 4), 4);
  expect(retained[1]).toBeCloseTo(retained[0], 4);
});

it("selects geothermal peaks rather than random points on a heat gradient", () => {
  const state = scenario(16384),
    map = state.physical!.map;
  const field = state.physical!.magic!.fields[0];
  field.definition.parameters.maximumSources = 10;
  for (let i = 0; i < map.mesh.count; i++)
    map.HeatSourceDensity[i] = Math.round(500 + map.mesh.x[i] / 2000);
  locateMagicSources(state, field, 42);
  expect(field.source.some((value) => value > 0)).toBe(true);
  for (let i = 0; i < map.mesh.count; i++) {
    if (!field.source[i]) continue;
    for (let edge = 0; edge < 3; edge++) {
      const j = map.mesh.neighbors[i * 3 + edge];
      if (j >= 0) expect(map.HeatSourceDensity[j]).toBeLessThanOrEqual(map.HeatSourceDensity[i]);
    }
  }
});

it("retains coastal source eligibility when the coastal sampling strip gets finer", () => {
  for (const samples of [4096, 16384]) {
    const state = scenario(samples),
      map = state.physical!.map;
    const field = state.physical!.magic!.fields[2],
      p = field.definition.parameters;
    for (let i = 0; i < map.mesh.count; i++) map.WaterKindCodes[i] = map.mesh.x[i] < 0 ? 1 : 0;
    Object.assign(p, {
      coastalSources: 30,
      coastalSourceDistance: 200_000,
      coastalRayDistance: 1,
      rayCount: 0,
      wakeSources: 0,
    });
    propagateMagic(state, field, 42, 1);
    expect(field.rogue.reduce((sum, value) => sum + value, 0)).toBe(30);
    for (let i = 0; i < map.mesh.count; i++)
      if (field.rogue[i]) expect(-map.mesh.x[i]).toBeLessThan(200_000 + map.mesh.spacing);
  }
});

it("publishes wake membership over the physical beam width", () => {
  const areas: number[] = [];
  // Resolve the beam radius with five and ten cells; a two-cell disk is only a coarse mask.
  for (const samples of [16384, 65536]) {
    const state = scenario(samples),
      map = state.physical!.map;
    const field = state.physical!.magic!.fields[2];
    map.WaterKindCodes.fill(1);
    Object.assign(field.definition.parameters, {
      rayCount: 0,
      coastalSources: 0,
      wakeSources: 1,
      wakeDistance: 1,
      beamWidth: 100_000,
    });
    propagateMagic(state, field, 42, 1);
    expect(field.wake).toEqual(Float64Array.from(field.intensity, (value) => Number(value > 0)));
    areas.push(field.wake.reduce((sum, value, i) => sum + value * map.mesh.areas[i], 0));
  }
  expect(areas[1] / areas[0]).toBeGreaterThan(0.9);
  expect(areas[1] / areas[0]).toBeLessThan(1.1);
});

it("records hot source chambers and removes inactive source cores", () => {
  const state = scenario(),
    map = state.physical!.map,
    field = state.physical!.magic!.fields[0];
  map.HeatSourceDensity.fill(1000);
  field.definition.parameters.maximumSources = 1;
  locateMagicSources(state, field, 42);
  propagateMagic(state, field, 42, 1);
  magicThermalFeedback(state);
  expect(map.FeatureFlags.some((value) => Boolean(value & Feature.MagmaChamber))).toBe(true);
  propagateMagic(state, field, 42, 0);
  magicThermalFeedback(state);
  classifyMagicFeatures(state);
  expect(
    map.FeatureFlags.some((value) => Boolean(value & (Feature.FireCore | Feature.MagmaChamber)))
  ).toBe(false);
  expect(field.features.core.every((value) => value === 0)).toBe(true);
});

function context(state: ReturnType<typeof scenario>, epoch: number): MapProcessContext {
  return {
    scope: state.domain.scope,
    invocation: [],
    parameters: {},
    epochs: [],
    epochIndices: [epoch],
    causes: [],
    recordCause() {},
    random: () => 0.5,
    cancelled: () => false,
    progress() {},
  };
}

it("keeps first coastal occurrence with advected coastal history and resets new crust", () => {
  const state = scenario(),
    map = state.physical!.map,
    field = state.physical!.magic!.fields[2];
  for (let i = 0; i < map.mesh.count; i++) map.WaterKindCodes[i] = map.mesh.x[i] < 0 ? 1 : 0;
  field.intensity.fill(500);
  magicCoastalFeedback(state, context(state, 0));
  const source = field.coastalHistory.findIndex((value) => value > 0);
  expect(source).toBeGreaterThanOrEqual(0);
  magicCoastalFeedback(state, context(state, 2));
  expect(field.coastalFirstEpoch[source]).toBe(0);
  map.AdvectionSourceIndex.fill(-1);
  map.AdvectionSourceIndex[0] = source;
  const history = field.coastalHistory[source];
  advectMagic(state);
  expect(field.coastalHistory[0]).toBe(history);
  expect(field.coastalFirstEpoch[0]).toBe(0);
  expect(field.coastalHistory[1]).toBe(0);
  expect(field.coastalFirstEpoch[1]).toBe(-1);
  projectMagic(state);
  expect(state.surface.units["magic:pressure:coastalFirstEpoch"]).toBe("category");
});

it("keeps an independently configured interaction when its container system is disabled", () => {
  const state = scenario(),
    [warm, cold, owner] = state.physical!.magic!.fields;
  warm.definition.id = "warm";
  cold.definition.id = "cold";
  warm.intensity.fill(500);
  cold.intensity.fill(500);
  owner.definition.enabled = false;
  owner.definition.features = [
    {
      id: "collision",
      name: "Opposed powers",
      priority: 100,
      seeds: [
        [
          { field: "system:warm", min: 260 },
          { field: "system:cold", min: 340 },
        ],
      ],
    },
  ];
  classifyMagicFeatures(state);
  expect(owner.features.collision.every((value) => value === 1)).toBe(true);
});
