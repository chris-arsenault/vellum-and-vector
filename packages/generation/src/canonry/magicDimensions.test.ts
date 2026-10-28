import { expect, it } from "vitest";
import { canonryMagicPresets, rectangle } from "@atlas/domain";
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
import { areaBudget, mediumArea, referenceLandArea, referenceOceanArea } from "./worldScale";

function scenario(samples = 4096, width = 2_000_000, height = 1_000_000) {
  const state = landscape();
  const size = Math.sqrt((width * height) / samples);
  const map = createField(
    createAdaptiveWorldMesh(
      [0, 0, width, height],
      { maximumSize: size, minimumSize: size },
      0,
      rectangle([0, 0, width, height])
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
  initializeMagic(state);
  return state;
}
const allCells = (count: number) => Array.from({ length: count }, (_, i) => i);

/**
 * A reference mesh whose content cells form one chain, a cell joined only to the next and the
 * previous, at a fixed physical spacing; cell `ids[k]` is the chain's k-th cell.
 */
function chainMesh(steps: number) {
  const mesh = createMesh(steps + 1, 0),
    ids = allCells(mesh.count).filter((i) => mesh.membership(i) === 1),
    position = new Map(ids.map((id, k) => [id, k])),
    spacing = 40_000 / steps;
  Object.defineProperty(mesh, "spacing", { value: spacing });
  Object.assign(mesh, {
    area: () => 100_000_000,
    edgeLength: () => spacing,
    neighbor: (cell: number, edge: number) => {
      const k = position.get(cell);
      if (k === undefined) return -1;
      const next = edge === 0 ? k + 1 : edge === 1 ? k - 1 : -1;
      return next >= 0 && next <= steps ? ids[next] : -1;
    },
  });
  return { mesh, ids };
}

it("scales Fire and deep-ocean source budgets with their physical medium, independent of sampling", () => {
  for (const samples of [1024, 4096]) {
    for (const scale of [1, 4]) {
      const state = scenario(samples, 4_000_000 * scale, 3_000_000),
        map = state.physical!.map;
      const [fire, , pressure] = state.physical!.magic!.fields;
      map.WaterKindCodes.fill(0);
      map.HeatSourceDensity.fill(1000);
      fire.definition.parameters.maximumSources = 4;
      locateMagicSources(state, fire, 73);
      expect(fire.located).toHaveLength(areaBudget(4, mediumArea(map), referenceLandArea));
      locateMagicSources(state, pressure, 73);
      expect(pressure.located).toHaveLength(0);

      map.WaterKindCodes.fill(1);
      map.WaterDepths.fill(3000);
      locateMagicSources(state, pressure, 73);
      expect(pressure.located).toHaveLength(areaBudget(1, mediumArea(map), referenceOceanArea));
      expect(Array.from(pressure.source).filter((value) => value > 0)).toHaveLength(
        pressure.located.length
      );
      locateMagicSources(state, fire, 73);
      expect(fire.located).toHaveLength(0);
    }
  }
});

it("captures the same cold activity over a fixed physical travel distance", () => {
  const retained: number[] = [];
  for (const steps of [4, 8]) {
    const state = scenario(64),
      { mesh, ids } = chainMesh(steps),
      map = createField(mesh);
    state.physical!.map = map;
    map.IceThickness.fill(400);
    for (let i = 0; i <= steps; i++) map.Temperature.set(ids[i], 500 - i);
    initializeMagic(state);
    const field = state.physical!.magic!.fields[1];
    field.source.set(ids[0], 100);
    propagateMagic(state, field, 42, 1);
    retained.push(ids.slice(0, steps).reduce((sum, id) => sum + field.retained.get(id), 0));
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
    map.HeatSourceDensity.set(i, Math.round(500 + map.mesh.x(i) / 2000));
  locateMagicSources(state, field, 42);
  expect(Array.from(field.source).some((value) => value > 0)).toBe(true);
  for (let i = 0; i < map.mesh.count; i++) {
    if (!field.source.get(i)) continue;
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      if (j >= 0)
        expect(map.HeatSourceDensity.get(j)).toBeLessThanOrEqual(map.HeatSourceDensity.get(i));
    }
  }
});

it("retains coastal source density and eligibility when the sampling strip gets finer", () => {
  const counts: number[] = [];
  for (const samples of [4096, 16384]) {
    const state = scenario(samples),
      map = state.physical!.map;
    const field = state.physical!.magic!.fields[2],
      p = field.definition.parameters;
    for (let i = 0; i < map.mesh.count; i++) map.WaterKindCodes.set(i, map.mesh.x(i) < 0 ? 1 : 0);
    Object.assign(p, {
      coastalSources: 30,
      coastalSourceDistance: 200_000,
      coastalRayDistance: 1,
      rayCount: 0,
      wakeSources: 0,
    });
    propagateMagic(state, field, 42, 1);
    counts.push(Array.from(field.rogue).reduce((sum, value) => sum + value, 0));
    expect(counts.at(-1)).toBeGreaterThan(0);
    for (let i = 0; i < map.mesh.count; i++)
      if (field.rogue.get(i)) expect(-map.mesh.x(i)).toBeLessThan(200_000 + map.mesh.spacing);
  }
  expect(counts[1]).toBe(counts[0]);
});

it("publishes wake membership over the physical beam width", () => {
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
    // Measure the kernel at a fixed interior station, independently of edge-source placement.
    const source = nearestTriangle(map.mesh, 0, 0);
    traceOceanBeam(map, field, 42, source, 0, 150, 1, true);
    expect(Array.from(field.wake)).toEqual(
      Array.from(field.intensity, (value) => Number(value > 0))
    );
    const radius = field.definition.parameters.beamWidth / 2;
    for (let i = 0; i < map.mesh.count; i++) {
      if (map.mesh.membership(i) !== 1) continue;
      const distance = Math.hypot(
        map.mesh.x(i) - map.mesh.x(source),
        map.mesh.y(i) - map.mesh.y(source)
      );
      const halfDiagonal = Math.hypot(map.mesh.cellWidth(i), map.mesh.cellHeight(i)) / 2;
      // Only cells intersecting the physical disk can be marked; every wholly interior cell is.
      if (field.wake.get(i)) expect(distance).toBeLessThan(radius + halfDiagonal);
      if (distance + halfDiagonal < radius) expect(field.wake.get(i)).toBe(1);
    }
  }
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
  expect(Array.from(map.FeatureFlags).some((value) => Boolean(value & Feature.MagmaChamber))).toBe(
    true
  );
  propagateMagic(state, field, 42, 0);
  magicThermalFeedback(state);
  classifyMagicFeatures(state);
  expect(
    Array.from(map.FeatureFlags).some((value) =>
      Boolean(value & (Feature.FireCore | Feature.MagmaChamber))
    )
  ).toBe(false);
  expect(Array.from(field.features.core).every((value) => value === 0)).toBe(true);
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
    if (!field.intensity.get(i)) continue;
    const dx = map.mesh.x(i) - map.mesh.x(source),
      dy = map.mesh.y(i) - map.mesh.y(source);
    const across = Math.abs(dy * Math.cos(angle) - dx * Math.sin(angle));
    expect(across).toBeLessThan(
      field.definition.parameters.beamWidth / 2 +
        Math.hypot(map.mesh.cellWidth(i), map.mesh.cellHeight(i)) / 2
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
  for (let i = 0; i < map.mesh.count; i++) map.WaterKindCodes.set(i, map.mesh.x(i) < 0 ? 1 : 0);
  field.intensity.fill(500);
  magicCoastalFeedback(state, context(state, 0));
  const source = Array.from(field.coastalHistory).findIndex((value) => value > 0);
  expect(source).toBeGreaterThanOrEqual(0);
  magicCoastalFeedback(state, context(state, 2));
  expect(field.coastalFirstEpoch.get(source)).toBe(0);
  map.AdvectionSourceIndex.fill(-1);
  map.AdvectionSourceIndex.set(0, source);
  const history = field.coastalHistory.get(source);
  advectMagic(state);
  expect(field.coastalHistory.get(0)).toBe(history);
  expect(field.coastalFirstEpoch.get(0)).toBe(0);
  expect(field.coastalHistory.get(1)).toBe(0);
  expect(field.coastalFirstEpoch.get(1)).toBe(-1);
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
  expect(Array.from(owner.features.collision).every((value) => value === 1)).toBe(true);
});
