import { expect, it } from "vitest";
import { canonryMagicPresets, rectangle, preparedValue } from "@atlas/domain";
import { landscape } from "../mapFixtures";
import type { MapProcessContext } from "../process";
import { createAdaptiveWorldMesh } from "./adaptiveMesh";
import { createMesh } from "./mesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { advectMagic, initializeMagic } from "./magicState";
import { locateMagicSources } from "./magicSources";
import { propagateMagic } from "./magicPropagation";
import { magicCoastalFeedback, magicThermalFeedback } from "./magicFeedback";
import { classifyMagicFeatures, projectMagic } from "./magicFeatures";
import { Feature } from "./codes";
import { traceOceanBeam } from "./magicBeams";
import { nearestTriangle } from "./mesh";
import { prepareMagicFields } from "./magicContinuous";
import { refreshWorkspaceSamples } from "./atlasWorkspace";

function scenario(samples = 4096) {
  const state = landscape();
  const size = 2_000_000 / Math.sqrt(samples);
  const map = createField(
    createAdaptiveWorldMesh(
      [0, 0, 2_000_000, 1_000_000],
      { maximumSize: size, minimumSize: size },
      0,
      rectangle([0, 0, 2_000_000, 1_000_000])
    )
  );
  state.domain.world.magicSystems = canonryMagicPresets();
  state.domain.scope.footprint = rectangle([0, 0, 2_000_000, 1_000_000]);
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    samples: new Int32Array(state.surface.active.length),
    fixed: [],
    inherited: false,
    sampling: { maximumSize: map.mesh.spacing, minimumSize: map.mesh.spacing, featureSamples: 2 },
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
    for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
      const j = map.mesh.neighbors[i * map.mesh.stride + edge];
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
  refreshWorkspaceSamples(state, state.physical!);
  prepareMagicFields(state, "advection");
  classifyMagicFeatures(state);
  expect(
    map.FeatureFlags.some((value) => Boolean(value & (Feature.FireCore | Feature.MagmaChamber)))
  ).toBe(false);
  expect(field.features.core.every((value) => value === 0)).toBe(true);
});

it("propagates an oblique ocean ray without snapping its heading to adaptive faces", () => {
  const state = scenario(16_384),
    map = state.physical!.map;
  const field = state.physical!.magic!.fields[2];
  map.WaterKindCodes.fill(1);
  const angle = 0.37,
    source = nearestTriangle(map.mesh, -500_000, -200_000);
  traceOceanBeam(map, field, 12, source, angle, 1000, 700_000);
  let far = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    if (!field.intensity[i]) continue;
    const dx = map.mesh.x[i] - map.mesh.x[source],
      dy = map.mesh.y[i] - map.mesh.y[source];
    const across = Math.abs(dy * Math.cos(angle) - dx * Math.sin(angle));
    expect(across).toBeLessThan(
      field.definition.parameters.beamWidth / 2 +
        Math.hypot(map.mesh.cellWidth[i], map.mesh.cellHeight[i]) / 2
    );
    far = Math.max(far, dx * Math.cos(angle) + dy * Math.sin(angle));
  }
  expect(far).toBeGreaterThan(650_000);
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
  prepareMagicFields(state, "coast");
  const source = field.coastalHistory.findIndex((value) => value > 0);
  expect(source).toBeGreaterThanOrEqual(0);
  magicCoastalFeedback(state, context(state, 2));
  expect(field.coastalFirstEpoch[source]).toBe(0);
  const minX = Math.min(...map.mesh.x),
    maxX = Math.max(...map.mesh.x);
  const target = map.mesh.x.findIndex((x, i) => x === minX && map.mesh.y[i] === map.mesh.y[source]);
  const fresh = map.mesh.x.findIndex((x, i) => x === maxX && map.mesh.y[i] === map.mesh.y[source]);
  expect(target).toBeGreaterThanOrEqual(0);
  expect(fresh).toBeGreaterThanOrEqual(0);
  map.LastPlateDriftStep = map.mesh.x[source] - map.mesh.x[target];
  map.provinces = {
    origin: [...map.mesh.origin],
    seed: 1,
    scale: 100_000,
    strength: 0,
    sites: [{ x: 0, y: 0, priority: 0, assembly: 1, motionX: -1, motionY: 0 }],
  };
  prepareMagicFields(state, "coast");
  const historyAt = preparedValue(map.continuous!.support, field.coastalHistory, {
    coefficients: field.coefficients?.coastalHistory,
    adaptive: field.adaptive?.coastalHistory,
  });
  const history = historyAt(
    map.mesh.x[source] + map.mesh.origin[0],
    map.mesh.y[source] + map.mesh.origin[1]
  );
  advectMagic(state);
  expect(field.coastalHistory[target]).toBe(history);
  expect(field.coastalFirstEpoch[target]).toBe(0);
  expect(field.coastalHistory[fresh]).toBe(0);
  expect(field.coastalFirstEpoch[fresh]).toBe(-1);
  refreshWorkspaceSamples(state, state.physical!);
  prepareMagicFields(state, "advection");
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
  refreshWorkspaceSamples(state, state.physical!);
  prepareMagicFields(state, "advection");
  classifyMagicFeatures(state);
  expect(owner.features.collision.every((value) => value === 1)).toBe(true);
});
