import { expect, it, vi } from "vitest";
import type { PhysicalField } from "./canonry/field";
import {
  builtinLayers,
  createAdaptiveField,
  createAdaptiveTopology,
  gridPosition,
  residentBand,
  resolutionCells,
} from "@atlas/domain";
import { landscape, epoch } from "./mapFixtures";
import { adaptivePhysicalMesh } from "./canonry/adaptiveMesh";
import { createField } from "./canonry/field";
import { atlasPhysicalProfile } from "./canonry/atlasProfile";
import { physicalContext } from "./canonry/context";
import { oceanConnectivity } from "./canonry/ocean";
import { drainageConditioning } from "./canonry/drainageFlood";
import { lakeBasins } from "./canonry/lakes";
import { drainageGuidance } from "./canonry/flowGuidance";
import { flowRouting } from "./canonry/routing";
import { riverNetwork } from "./canonry/rivers";
import { projectNative } from "./canonry/atlasProjection";
import { defaultAtlasParameters } from "./atlasParameters";
import { generationBindings, serializableBindings } from "./generationBindings";
import { generationSettingsSchema } from "./generationSettings";
import { initializePopulation } from "./societyPopulation";
import { applySocietyWorks, changeSample, makeWork } from "./societyWorks";
import { refreshSocietyEnvironment } from "./societyEnvironment";
import type { MapProcessContext } from "./process";
import { initializeMagic } from "./canonry/magicState";
import * as propagation from "./canonry/magicPropagation";

// The fixture assembles a complete native water pipeline and its atlas bindings.
// eslint-disable-next-line max-lines-per-function
function fixture() {
  const state = landscape(),
    topology = createAdaptiveTopology(state.surface.bounds, { maximumSize: 250, minimumSize: 250 });
  state.domain.world.id = "bc07dcd0-7cba-46b1-8e56-5f7829dde8cb";
  state.domain.world.layers = Object.fromEntries(builtinLayers().map((l) => [l.id, l]));
  state.surface = createAdaptiveField("land", state.domain.scope, topology);
  const lattice = adaptivePhysicalMesh(topology, state.domain.scope.footprint);
  const map = createField(lattice);
  const profile = atlasPhysicalProfile();
  map.OpenBoundary = true;
  map.SeaLevelInitialized = true;
  for (let i = 0; i < map.mesh.count; i++) {
    const x = map.mesh.x(i) + map.mesh.origin[0],
      y = map.mesh.y(i) + map.mesh.origin[1];
    map.Elevation.set(i, (x < 250 ? -10 : 1 + x / 1000 + Math.abs(y - 500) / 20) * 1024);
  }
  map.BedrockElevation.copyFrom(map.Elevation);
  map.Temperature.fill(400);
  map.Runoff.fill(800);
  map.Rainfall.fill(800);
  map.Moisture.fill(700);
  const physical = physicalContext(42, 0, profile);
  for (const process of [
    oceanConnectivity,
    drainageConditioning,
    lakeBasins,
    drainageGuidance,
    flowRouting,
    riverNetwork,
  ])
    process(map, physical);
  state.physical = {
    map,
    profile,
    samples: residentBand("int32", lattice.leafCells()),
    grid: state.surface.coverage,
    inherited: false,
    fixed: [],
    sampling: { maximumSize: 250, minimumSize: 250, featureSamples: 2 },
  };
  projectNative(state);
  const settings = generationSettingsSchema.parse({
    epochs: [
      {
        id: "Landscape",
        duration: 1000,
        tectonics: 0,
        hydrology: 1,
        ice: 0,
        coasts: 0,
        temperature: 15,
        seaLevel: 0,
      },
    ],
    humanEras: [],
    magicSystems: [],
  });
  const context: MapProcessContext = {
    scope: state.domain.scope,
    invocation: [],
    parameters: {},
    epochs: [epoch("People", 20)],
    epochIndices: [0],
    causes: [],
    recordCause() {},
    random: () => 0.5,
    cancelled: () => false,
    progress() {},
    inputs: serializableBindings({
      seed: 42,
      quality: "draft",
      domains: ["physical", "built"],
      settings,
      parameters: defaultAtlasParameters,
      features: { selection: {}, diagnostics: [], parameters: defaultAtlasParameters },
    }),
  };
  initializePopulation(state, context);
  return { state, context };
}
it("keeps configured magic absent when fresh physical generation omitted it", () => {
  const { state, context } = fixture(),
    bound = generationBindings(context);
  context.inputs = serializableBindings({
    ...bound,
    features: {
      ...bound.features,
      selection: { "magic.configured": { enabled: false, settings: {}, configuration: {} } },
    },
  });
  changeSample(state, "elevation", 0, 10);
  refreshSocietyEnvironment(state, context, 0, false);
  expect(state.physical!.magic!.fields).toEqual([]);
  expect(Object.keys(state.surface.channels).filter((name) => name.startsWith("magic:"))).toEqual(
    []
  );
});

it("refreshes a dam reservoir and downstream routing without advancing geological history", () => {
  const { state, context } = fixture(),
    map = state.physical!.map;
  const c = state.society!.region.communities[0];
  c.groups[0].count = 1000;
  const work = makeWork(state, c, "dam", { x: 1875, y: 375, z: 0 });
  work.radius = 400;
  work.magnitude = 3;
  state.society!.region.works = [work];
  const geologicalEvents = structuredClone(map.events),
    tectonics = Array.from(map.CrustMotionX);
  applySocietyWorks(state, context, 20);
  refreshSocietyEnvironment(state, context, 20);
  expect(Array.from(map.WaterKindCodes).some((v) => v === 2)).toBe(true);
  expect(state.surface.lakes?.length).toBeGreaterThan(0);
  expect(Object.values(state.domain.world.features).some((f) => f.kind === "lake")).toBe(false);
  expect(map.events).toEqual(geologicalEvents);
  expect(Array.from(map.CrustMotionX)).toEqual(tectonics);
  const { water, waterDepth } = state.surface.channels;
  for (let i = 0; i < water.length; i++)
    if (water.get(i) === 2) expect(waterDepth.get(i)).toBeGreaterThan(0);
  expect(Number.isFinite(gridPosition(state.surface, 0).x)).toBe(true);
});
it("leaves water, terrain and the lake set untouched by a World dam demand", () => {
  const { state, context } = fixture(),
    map = state.physical!.map;
  const c = state.society!.region.communities[0];
  c.groups[0].count = 1000;
  const demand = makeWork(state, c, "dam");
  expect(demand.demand).toMatchObject({ unit: "cubic-metre/second" });
  demand.magnitude = 3;
  state.society!.region.works = [demand];
  const elevation = Array.from(map.Elevation),
    water = Array.from(map.WaterKindCodes);
  applySocietyWorks(state, context, 20);
  refreshSocietyEnvironment(state, context, 20);
  expect(damCount(map)).toBe(0);
  expect(Array.from(map.Elevation)).toEqual(elevation);
  expect(Array.from(map.WaterKindCodes)).toEqual(water);
  expect(Object.values(state.domain.world.features).some((f) => f.kind === "lake")).toBe(false);
});
const damCount = (map: PhysicalField) =>
  map.EngineeredDams ? Array.from(map.EngineeredDams).filter(Boolean).length : 0;
it("realizes a World dam demand at the era's end only when its impoundment spans the mesh", () => {
  const { state, context } = fixture(),
    map = state.physical!.map;
  const c = state.society!.region.communities[0];
  c.groups[0].count = 1000;
  const dam = makeWork(state, c, "dam");
  dam.magnitude = 3;
  state.society!.region.works = [dam];
  applySocietyWorks(state, context, 20);
  refreshSocietyEnvironment(state, context, 20, true);
  const lakeCells = Array.from(map.WaterKindCodes).filter((v) => v === 2).length;
  if (dam.demand) {
    // Below the resolution rule: nothing of the dam exists at World.
    expect(damCount(map)).toBe(0);
    expect(lakeCells).toBe(0);
  } else {
    expect(dam.causes.at(-1)).toContain("Realized at World");
    expect(damCount(map)).toBeGreaterThan(0);
    expect(lakeCells).toBeGreaterThanOrEqual(resolutionCells);
    expect(dam.position).not.toEqual(c.position);
  }
});
it("synchronizes a forge's seat heat without re-propagating Aurora, and re-propagates for a work on ice", () => {
  const { state, context } = fixture();
  initializeMagic(state);
  const trace = vi.spyOn(propagation, "propagateMagic");
  try {
    const cold = (calls: typeof trace.mock.calls) =>
      calls.some(([, field]) => field.definition.origins[0].propagation === "cold-drainage");
    expect(
      state.physical!.magic!.fields.some(
        (f) => f.definition.origins[0].propagation === "cold-drainage"
      )
    ).toBe(true);
    changeSample(state, "temperature", 0, 30, "practice");
    changeSample(state, "iceThickness", 0, 0, "practice");
    refreshSocietyEnvironment(state, context, 10, false);
    expect(state.society!.changed.size).toBe(0);
    expect(cold(trace.mock.calls)).toBe(false);
    changeSample(state, "iceThickness", 1, 50, "work");
    expect(state.society!.mediumChanged.has("iceThickness")).toBe(true);
    refreshSocietyEnvironment(state, context, 10, false);
    expect(cold(trace.mock.calls)).toBe(true);
  } finally {
    trace.mockRestore();
  }
});

it("retains Pressure rays for inland earthworks and retraces them when ocean connectivity changes", () => {
  const { state, context } = fixture();
  initializeMagic(state);
  const trace = vi.spyOn(propagation, "propagateMagic");
  try {
    const water = Array.from(state.physical!.map.WaterKindCodes);
    const elevation = state.surface.channels.elevation;
    for (let i = 0; i < elevation.length; i++) {
      const height = elevation.get(i);
      if (height > 0) changeSample(state, "elevation", i, height + 1);
    }
    state.society!.changed.add("elevation");
    refreshSocietyEnvironment(state, context, 10, false);
    expect(Array.from(state.physical!.map.WaterKindCodes, (v) => Number(v === 1))).toEqual(
      water.map((v) => Number(v === 1))
    );
    expect(
      trace.mock.calls.some(([, field]) => field.definition.origins[0].propagation === "ocean-rays")
    ).toBe(false);
    for (let i = 0; i < state.surface.channels.elevation.length; i++)
      changeSample(state, "elevation", i, -100);
    state.society!.changed.add("elevation");
    refreshSocietyEnvironment(state, context, 10, false);
    expect(
      trace.mock.calls.some(([, field]) => field.definition.origins[0].propagation === "ocean-rays")
    ).toBe(true);
    trace.mockClear();
    // A whole-field cold change is a change of Aurora's medium, so it is marked as a work's.
    state.surface.channels.temperature.fill(-20);
    state.society!.changed.add("temperature");
    state.society!.mediumChanged.add("temperature");
    refreshSocietyEnvironment(state, context, 10, false);
    expect(
      trace.mock.calls.some(
        ([, field]) => field.definition.origins[0].propagation === "cold-drainage"
      )
    ).toBe(true);
  } finally {
    trace.mockRestore();
  }
});

it("transfers local earthwork deltas without resampling unrelated terrain", () => {
  const { state, context } = fixture(),
    map = state.physical!.map;
  const before = Array.from(map.Elevation);
  const work = makeWork(state, state.society!.region.communities[0], "pass", {
    x: 1875,
    y: 375,
    z: 0,
  });
  work.radius = 300;
  state.society!.region.works = [work];
  applySocietyWorks(state, context, 10);
  refreshSocietyEnvironment(state, context, 10, false);
  expect(Array.from(map.Elevation)).not.toEqual(before);
  for (let i = 0; i < before.length; i++) {
    const x = map.mesh.x(i) + map.mesh.origin[0];
    if (x < 500 || x > 3250) expect(map.Elevation.get(i)).toBe(before[i]);
  }
  expect(state.society!.elevationBefore).toBeUndefined();
});
