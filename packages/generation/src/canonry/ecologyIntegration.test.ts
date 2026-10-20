import { expect, it } from "vitest";
import {
  builtinLayers,
  createAdaptiveField,
  createAdaptiveTopology,
  refineAdaptiveWhere,
  rectangle,
  magicSystemSchema,
} from "@atlas/domain";
import { landscape } from "../mapFixtures";
import type { MapProcessContext, GenerationCause } from "../process";
import { adaptivePhysicalMesh } from "./adaptiveMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { ecologyProcesses } from "./ecologyProcesses";
import { ecologyBindings } from "./ecologyState";
import { projectNative } from "./atlasProjection";
import { remeshPhysical } from "./physicalRemesh";
import { initializeMagic } from "./magicState";
import { transportHistory } from "./transportHistory";
import { buildTransportPlan } from "./transportPlan";
import { atlasConfiguration } from "../atlasWorkflow";
import { sequenceStages } from "../sequence";
import { extractEcologicalFeatures } from "./ecologyFeatures";
import { prepareGeneratedProcess } from "../mapFeatures";
import { spatial } from "@atlas/domain";

function fixture() {
  const state = landscape();
  const topology = createAdaptiveTopology(state.surface.bounds, {
    maximumSize: 500,
    minimumSize: 125,
  });
  state.surface = createAdaptiveField("ecology", state.domain.scope, topology);
  const map = createField(adaptivePhysicalMesh(topology, state.domain.scope.footprint));
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    fixed: [],
    inherited: false,
    samples: map.mesh.leafToCell,
    sampling: { maximumSize: 500, minimumSize: 125, featureSamples: 2 },
  };
  map.Temperature.fill(450);
  map.Moisture.fill(700);
  map.Rainfall.fill(800);
  map.Elevation.fill(100 * 1024);
  map.BedrockElevation.fill(90 * 1024);
  map.SedimentThickness.fill(10 * 1024);
  map.DrainageElevations.set(map.Elevation);
  map.Slope.fill(0.02);
  map.BroadleafSeed.fill(0.08);
  map.ConiferSeed.fill(0.08);
  state.domain.world.layers = Object.fromEntries(builtinLayers().map((layer) => [layer.id, layer]));
  return state;
}
function context(years = 1000) {
  const causes: GenerationCause[] = [];
  const c: MapProcessContext = {
    scope: landscape().domain.scope,
    invocation: ["ecology"],
    parameters: {},
    epochs: [{ id: "epoch", duration: years, parentEpoch: null, variables: {} }],
    epochIndices: [0],
    causes,
    recordCause: (cause) => causes.push(cause),
    random: () => 0.5,
    cancelled: () => false,
    progress: () => {},
  };
  return c;
}
const input = { areaId: "area", quality: "draft", seed: 42, domains: ["physical"] };
function process(name: string) {
  return ecologyProcesses(input).find((p) => p.contract.id === `atlas.ecology-${name}`)!;
}

it("publishes all ecological channels in the same located field and records completed epoch causes", () => {
  const state = fixture(),
    c = context();
  process("initialize").apply(state, c);
  process("evolve").apply(state, c);
  process("respond").apply(state, c);
  process("burial").apply(state, c);
  process("burial").validate(state, c);
  projectNative(state);
  for (const [name, native, unit] of ecologyBindings) {
    expect(state.surface.units[name]).toBe(unit);
    for (let leaf = 0; leaf < state.surface.active.length; leaf++)
      expect(state.surface.channels[name][leaf]).toBeCloseTo(
        state.physical!.map[native][state.physical!.map.mesh.leafToCell[leaf]],
        8
      );
  }
  expect(
    c.causes.some(
      (cause) => cause.kind === "domain" && cause.description.includes("Temperate forest")
    )
  ).toBe(true);
});

it("uses configured magical intensity rather than a magic system name", () => {
  const state = fixture(),
    control = fixture(),
    c = context();
  state.domain.world.magicSystems = [
    magicSystemSchema.parse({
      id: "strange-sun",
      name: "Strange sun",
      source: "placed",
      propagation: "radial",
      phase: "climate",
      effects: { fire: 0.9 },
    }),
  ];
  initializeMagic(state);
  state.physical!.magic!.fields[0].intensity.fill(1000);
  for (const candidate of [state, control]) {
    process("initialize").apply(candidate, c);
    process("evolve").apply(candidate, c);
  }
  expect(state.physical!.map.TreeCover[0]).toBeLessThan(control.physical!.map.TreeCover[0] / 2);
  expect(state.physical!.map.FireActivity[0]).toBeGreaterThan(0.8);
});

it("applies present-day magical fire without replaying epochs or maturing source rocks", () => {
  const state = fixture(),
    c = context();
  state.domain.world.magicSystems = [
    magicSystemSchema.parse({
      id: "wild-light",
      name: "Wild light",
      source: "placed",
      propagation: "radial",
      phase: "climate",
      effects: { fire: 0.9 },
    }),
  ];
  initializeMagic(state);
  state.physical!.magic!.fields[0].intensity.fill(1000);
  const map = state.physical!.map;
  map.TreeCover.fill(0.8);
  map.BroadleafCover.fill(0.8);
  map.BiomeCodes.fill(10);
  map.BuriedAquaticCarbon.fill(100);
  map.OrganicBurialDepth.fill(3000);
  state.domain.world.id = "2f6e0134-6017-4e80-9196-052a12218500";
  projectNative(state);
  extractEcologicalFeatures(state);
  expect(Object.values(state.domain.world.features).some((f) => f.kind === "forest")).toBe(true);
  const elevation = state.surface.channels.elevation.slice();
  prepareGeneratedProcess(["magic"]).apply(state, c);
  const present = ecologyProcesses({ ...input, domains: ["magic"] }).find(
    (p) => p.contract.id === "atlas.ecology-present"
  )!;
  present.apply(state, c);
  expect(map.TreeCover[0]).toBeCloseTo(0.08);
  expect(map.OilCarbon[0]).toBe(0);
  expect(map.BuriedAquaticCarbon[0]).toBe(100);
  map.Elevation.fill(200 * 1024); // A magic-only projection retains the existing terrain.
  projectNative(state, false, true);
  extractEcologicalFeatures(state);
  expect(state.surface.channels.elevation).toEqual(elevation);
  expect(state.surface.channels.treeCover[0]).toBeCloseTo(0.08);
  expect(state.surface.channels.biome[0]).toBe(map.BiomeCodes[0]);
  expect(state.surface.channels.soilCarbon[0]).toBeGreaterThan(0);
  expect(Object.values(state.domain.world.features).some((f) => f.kind === "forest")).toBe(false);
});

it("does not create repeated mortality litter from protected cover during present reconciliation", () => {
  const state = fixture(),
    c = context(),
    map = state.physical!.map;
  map.TreeCover.fill(0.7);
  map.IceThickness.fill(5);
  state.physical!.fixed.push({
    binding: { name: "treeCover", native: "TreeCover", unit: "ratio", scale: 1 },
    values: new Float64Array(map.mesh.count).fill(0.7),
  });
  process("present").apply(state, c);
  process("present").apply(state, c);
  expect(map.TreeCover[0]).toBe(0.7);
  expect(map.SoilCarbon[0]).toBe(0);
});

it("preserves authored woodland and sampled cover through generation operations", () => {
  const state = fixture(),
    c = context();
  state.domain.world.features.wood = {
    id: "wood",
    name: "Authored wood",
    kind: "forest",
    layerId: "geology",
    areaId: "area",
    geometry: rectangle([0, 0, 2000, 1000]),
    detail: {},
    attributes: {},
    relations: [],
    state: "authored",
    protected: true,
    actor: "creator",
    generationId: null,
    causes: [],
  };
  const before = structuredClone(state.domain.world.features.wood);
  process("initialize").apply(state, c);
  state.physical!.map.Moisture.fill(100);
  process("evolve").apply(state, c);
  process("present").apply(state, c);
  const map = state.physical!.map;
  for (let i = 0; i < map.mesh.count; i++)
    if (map.mesh.x[i] + map.mesh.origin[0] < 2000)
      expect(map.TreeCover[i]).toBeGreaterThanOrEqual(0.7);
  expect(state.domain.world.features.wood).toEqual(before);
  state.physical!.fixed.push({
    binding: { name: "treeCover", native: "TreeCover", unit: "ratio", scale: 1 },
    values: new Float64Array(map.mesh.count).fill(0.45),
  });
  process("evolve").apply(state, c);
  expect(map.TreeCover.every((v) => v === 0.45)).toBe(true);
  state.physical!.fixed = [
    {
      binding: { name: "broadleafCover", native: "BroadleafCover", unit: "ratio", scale: 1 },
      values: new Float64Array(map.mesh.count).fill(0.6),
    },
  ];
  process("respond").apply(state, c);
  process("present").apply(state, c);
  expect(map.BroadleafCover.every((v) => v === 0.6)).toBe(true);
  expect(map.TreeCover.every((v) => v >= 0.6)).toBe(true);
});

it("does not replay geological age when refining inherited geography", () => {
  const state = fixture(),
    c = context(10_000_000);
  process("initialize").apply(state, c);
  const map = state.physical!.map;
  map.BuriedAquaticCarbon.fill(100);
  map.OrganicBurialDepth.fill(3000);
  map.OrganicMaturity.fill(5);
  map.TreeCover.fill(0.6);
  map.BroadleafCover.fill(0.6);
  state.physical!.inherited = true;
  process("evolve").apply(state, c);
  process("burial").apply(state, c);
  expect(map.BuriedAquaticCarbon[0]).toBe(100);
  expect(map.OilCarbon[0]).toBe(0);
  expect(map.OrganicMaturity[0]).toBe(5);
  expect(map.TreeCover[0]).toBe(0.6);
});

it("retains carbon inventories and cover across spatial refinement", () => {
  const state = fixture(),
    map = state.physical!.map;
  map.TreeCover.fill(0.65);
  map.PeatCarbon.set(Float64Array.from(map.mesh.x, (x) => 5 + (x + 2000) / 1000));
  map.BiomeCodes.fill(14);
  const topology = refineAdaptiveWhere(
    map.mesh.topology!,
    125,
    ([x, , right]) => x < 2000 && right > 1000
  );
  const next = remeshPhysical(map, topology, state.domain.scope.footprint);
  const integral = (field: typeof map) =>
    field.PeatCarbon.reduce((sum, value, i) => sum + value * field.mesh.areas[i], 0);
  expect(next.mesh.count).toBeGreaterThan(map.mesh.count);
  expect(integral(next)).toBeCloseTo(integral(map), 5);
  expect(next.TreeCover.every((v) => Math.abs(v - 0.65) < 1e-12)).toBe(true);
  expect(next.BiomeCodes.every((v) => v === 14)).toBe(true);
});

it("carries organic carbon with advecting crust without integer truncation of vegetation", () => {
  const state = fixture(),
    map = state.physical!.map;
  map.TreeCover.fill(0.65);
  map.PeatCarbon.fill(12.5);
  map.CrustMotionX.fill(1000);
  const before = map.PeatCarbon.reduce((sum, v, i) => sum + v * map.mesh.areas[i], 0);
  const plan = buildTransportPlan(map, 100);
  let exported = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    let retained = 0;
    for (let k = plan.offsets[i]; k < plan.offsets[i + 1]; k++) retained += plan.weights[k];
    exported += 12.5 * map.mesh.areas[i] * (1 - retained / 1_000_000);
  }
  transportHistory(map, plan);
  const after = map.PeatCarbon.reduce((sum, v, i) => sum + v * map.mesh.areas[i], 0);
  expect(after + exported).toBeCloseTo(before, 4);
  expect(map.TreeCover.some((v) => v > 0.6 && v < 0.7)).toBe(true);
});

it("orders vegetation before incision and organic burial after coastal deposition", () => {
  const state = fixture();
  state.domain.world.epochs = [
    { id: "first", tectonics: 1, hydrology: 1, ice: 0, coasts: 1, temperature: 15, seaLevel: 0 },
  ];
  const stages = sequenceStages(atlasConfiguration(state.domain, input).sequence);
  const epoch = stages
    .filter((stage) => stage.epochs.length && stage.invocation)
    .map((stage) => stage.invocation!.process);
  expect(epoch.indexOf("atlas.ecology-evolve")).toBeLessThan(
    epoch.indexOf("canonry.ancestral-fluvial-erosion")
  );
  expect(epoch.indexOf("atlas.ecology-burial")).toBeGreaterThan(
    epoch.indexOf("canonry.coastal-erosion-and-deposition")
  );
  const final = stages
    .filter((stage) => !stage.epochs.length && stage.invocation)
    .map((stage) => stage.invocation!.process);
  expect(final.indexOf("atlas.ecology-present")).toBeLessThan(
    final.indexOf("canonry.magic-classify")
  );
});

it("creates located forest polygons with deterministic identities and keeps authored woodland", () => {
  const state = fixture(),
    c = context();
  state.domain.world.id = "2f6e0134-6017-4e80-9196-052a12218500";
  process("initialize").apply(state, c);
  process("evolve").apply(state, c);
  process("respond").apply(state, c);
  process("present").apply(state, c);
  extractEcologicalFeatures(state);
  const forests = Object.values(state.domain.world.features).filter(
    (feature) => feature.kind === "forest"
  );
  expect(forests.length).toBeGreaterThan(0);
  for (const feature of forests) {
    expect(feature.layerId).toBe("ecology");
    expect(feature.attributes.biome).toBe("Temperate forest");
    expect(spatial.covers(state.domain.scope.footprint, feature.geometry)).toBe(true);
  }
  const ids = forests.map((feature) => feature.id);
  extractEcologicalFeatures(state);
  expect(
    Object.values(state.domain.world.features)
      .filter((feature) => feature.kind === "forest")
      .map((feature) => feature.id)
  ).toEqual(ids);
});

it("publishes selectable open-land biome polygons through the same scoped feature path", () => {
  const state = fixture();
  state.domain.world.id = "2f6e0134-6017-4e80-9196-052a12218500";
  const map = state.physical!.map;
  for (const [code, name] of [
    [4, "Barren"],
    [5, "Desert"],
    [6, "Tundra"],
    [7, "Grassland"],
    [8, "Savanna"],
  ] as const) {
    state.domain.world.features = {};
    map.BiomeCodes.fill(code);
    extractEcologicalFeatures(state);
    const features = Object.values(state.domain.world.features);
    expect(features.length).toBeGreaterThan(0);
    for (const feature of features) {
      expect(feature.attributes.biome).toBe(name);
      expect(feature.kind).toBe(name.toLowerCase());
      expect(feature.layerId).toBe("ecology");
      expect(feature.geometry.type).toMatch(/Polygon/);
      expect(spatial.covers(state.domain.scope.footprint, feature.geometry)).toBe(true);
    }
  }
});

it("keeps protected biome samples authoritative for both polygons and published categories", () => {
  const state = fixture();
  state.domain.world.id = "2f6e0134-6017-4e80-9196-052a12218500";
  state.physical!.map.TreeCover.fill(0.8);
  state.physical!.fixed.push({
    binding: { name: "biome", native: "BiomeCodes", unit: "category", scale: 1 },
    values: new Float64Array(state.physical!.map.mesh.count).fill(7),
  });
  process("present").apply(state, context());
  projectNative(state);
  extractEcologicalFeatures(state);
  expect(state.surface.channels.biome.every((v) => v === 7)).toBe(true);
  const features = Object.values(state.domain.world.features);
  expect(features.length).toBeGreaterThan(0);
  expect(features.every((f) => f.kind === "grassland")).toBe(true);
});
