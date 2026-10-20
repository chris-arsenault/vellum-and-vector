import { expect, it } from "vitest";
import {
  createAdaptiveField,
  createAdaptiveTopology,
  rectangle,
  type ParameterValues,
} from "@atlas/domain";
import { atlasFeatureDefinitions, atlasRegistry } from "../atlasWorkflow";
import { resolveGenerationFeatures } from "../features";
import { serializableBindings } from "../generationBindings";
import { worldGenerationSettings } from "../generationSettings";
import { landscape } from "../mapFixtures";
import { MapRunner } from "../mapRunner";
import { preflight } from "../preflight";
import type { ProcessConfiguration } from "../process";
import { adaptivePhysicalMesh } from "./adaptiveMesh";
import { atlasPhysicalProfile } from "./atlasProfile";
import { createField } from "./field";
import { remeshInvalidations } from "./adaptiveWorkspace";

function fixture(size: number) {
  const state = landscape();
  const footprint = rectangle([0, 0, 100_000, 100_000]);
  state.domain.world.id = state.domain.scope.worldId = "2f6e0134-6017-4e80-9196-052a12218500";
  state.domain.world.reference.domain = footprint;
  state.domain.scope.footprint = state.domain.world.areas.area.footprint = footprint;
  state.domain.world.areas.area.profile = "region";
  state.domain.world.magicSystems = [];
  state.domain.world.epochs = [
    {
      id: "Provided terrain",
      duration: 1000,
      tectonics: 1,
      hydrology: 1,
      ice: 1,
      coasts: 1,
      temperature: 15,
      seaLevel: 0,
    },
  ];
  const topology = createAdaptiveTopology([0, 0, 100_000, 100_000], {
    maximumSize: size,
    minimumSize: size,
  });
  const map = createField(adaptivePhysicalMesh(topology, footprint));
  map.OpenBoundary = true;
  for (let i = 0; i < map.mesh.count; i++)
    map.BedrockElevation[i] = map.Elevation[i] = (1000 - map.mesh.x[i] / 100) * 1024;
  map.Temperature.fill(150);
  map.Rainfall.fill(1000);
  state.surface = createAdaptiveField("provided-terrain", state.domain.scope, topology);
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    samples: map.mesh.leafToCell,
    fixed: [],
    inherited: false,
    sampling: { maximumSize: size, minimumSize: 3125, featureSamples: 2 },
  };
  state.facts = new Set(
    [
      "workspace",
      "Elevation",
      "Ocean",
      "Temperature",
      "Precipitation",
      "LandscapeHistory",
      "LakeState",
    ].map((product) => `canonry:${product}`)
  );
  return state;
}

function recipe(state: ReturnType<typeof fixture>, names: string[]) {
  const settings = worldGenerationSettings(state.domain.world);
  const features = resolveGenerationFeatures(
    atlasFeatureDefinitions,
    {},
    {},
    {},
    ["physical"],
    settings as unknown as ParameterValues
  );
  const registry = atlasRegistry(state.domain, {
    areaId: "area",
    domains: ["physical"],
    quality: "draft",
    seed: 73,
    resolvedFeatures: features,
  });
  const configuration: ProcessConfiguration = {
    id: "regional-reconciliation",
    version: 1,
    parameters: {},
    inputs: {
      ...serializableBindings({
        seed: 73,
        quality: "draft",
        domains: ["physical"],
        parameters: features.parameters,
        features,
        settings,
      }),
      reconciliations: JSON.parse(JSON.stringify(registry.reconciliations())),
    },
    sequence: names.map((name) => ({
      kind: "process",
      id: name,
      process: `canonry.${name}`,
      version: "0f62584c",
    })),
  };
  return { registry, configuration };
}

const water = [
  "runoff",
  "drainage-conditioning",
  "lake-basins",
  "drainage-guidance",
  "flow-routing",
  "river-network",
];

it.each([25_000, 3125])(
  "preflights and executes water reconciliation at cell width %s",
  async (size) => {
    const state = fixture(size),
      count = state.physical!.map.mesh.count;
    const { registry, configuration } = recipe(state, [...water, "refine-water"]);
    expect(preflight(configuration, registry, state.facts)).toEqual([]);
    const result = await new MapRunner(configuration, registry).run(state, {
      seed: "73",
      seedScope: "region",
    });
    const map = result.state.physical!.map;
    expect(map.mesh.count > count).toBe(size === 25_000);
    for (const product of ["Runoff", "Lakes", "LakeState", "LakeOutlets", "FlowRouting", "Rivers"])
      expect(result.state.facts.has(`canonry:${product}`), product).toBe(true);
    expect(map.FlowTargets.every((target) => target < map.mesh.count)).toBe(true);
    expect(map.LakeOutletTargets.every((target) => target < map.mesh.count)).toBe(true);
    expect(map.RiverOrders.some((order) => order > 0)).toBe(true);
  }
);

it.each([25_000, 3125])(
  "rebuilds ice routing without accumulating thickness at cell width %s",
  async (size) => {
    const state = fixture(size),
      map = state.physical!.map;
    map.IceThickness.fill(1000);
    state.facts.add("canonry:LandIce");
    const volume = map.IceThickness.reduce((sum, depth, i) => sum + depth * map.mesh.areas[i], 0);
    const count = map.mesh.count;
    const { registry, configuration } = recipe(state, ["ice-flow", "refine-ice"]);
    expect(preflight(configuration, registry, state.facts)).toEqual([]);
    const result = await new MapRunner(configuration, registry).run(state, {
      seed: "73",
      seedScope: "region",
    });
    const next = result.state.physical!.map;
    expect(next.mesh.count > count).toBe(size === 25_000);
    expect(
      next.IceThickness.reduce((sum, depth, i) => sum + depth * next.mesh.areas[i], 0)
    ).toBeCloseTo(volume, -2);
    expect(next.IceFlowTargets.some((target) => target >= 0)).toBe(true);
    expect(result.state.facts.has("canonry:IceFlow")).toBe(true);
    expect(result.state.facts.has("canonry:LakeState")).toBe(true);
  }
);

it("preflight revokes outlet topology on every possible remesh and rejects a premature routing consumer", () => {
  const state = fixture(25_000);
  for (const product of remeshInvalidations) state.facts.add(product);
  const { registry, configuration } = recipe(state, ["refine-climate", "flow-routing"]);
  expect(preflight(configuration, registry, state.facts)).toContainEqual(
    expect.objectContaining({ code: "generation_prerequisite", resource: "canonry:LakeOutlets" })
  );
});

it.each([25_000, 3125])(
  "revokes current lake outlets only when shore refinement changes cell width %s",
  async (size) => {
    const state = fixture(size),
      map = state.physical!.map;
    for (let i = 0; i < map.mesh.count; i++) {
      map.BedrockElevation[i] = map.Elevation[i] = (map.mesh.x[i] * 1024) / 100;
      if (map.mesh.x[i] < 0) {
        map.WaterKindCodes[i] = 1;
        map.WaterDepths[i] = -map.Elevation[i];
      }
    }
    const { registry, configuration } = recipe(state, [...water, "refine-climate"]);
    expect(preflight(configuration, registry, state.facts)).toEqual([]);
    const result = await new MapRunner(configuration, registry).run(state, {
      seed: "73",
      seedScope: "region",
    });
    expect(result.state.physical!.map.mesh.count > map.mesh.count).toBe(size === 25_000);
    expect(result.state.facts.has("canonry:LakeState")).toBe(true);
    for (const product of ["Lakes", "LakeOutlets", "FlowRouting"])
      expect(result.state.facts.has(`canonry:${product}`), product).toBe(size === 3125);
  }
);

it("declares possible native remeshing only for adaptive map profiles", () => {
  const state = fixture(25_000);
  for (const profile of ["world", "region"] as const) {
    state.domain.world.areas.area.profile = profile;
    const { registry } = recipe(state, []);
    for (const name of [
      "impact-cratering",
      "volcanic-construction",
      "fracture-network",
      "coastal-detail",
    ]) {
      const branch = registry.get(`canonry.${name}`, "0f62584c").contract.reconciliation;
      if (profile === "world") expect(branch).toBeUndefined();
      else
        expect(branch).toEqual({ invalidates: remeshInvalidations, sequence: [], guarantees: [] });
    }
  }
});
