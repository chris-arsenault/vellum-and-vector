import { expect, it } from "vitest";
import {
  builtinLayers,
  canonryMagicPresets,
  createGrid,
  rectangle,
  type ParameterValues,
} from "@atlas/domain";
import { atlasFeatureDefinitions, atlasRegistry, prepareAtlasGeneration } from "../atlasWorkflow";
import { resolveGenerationFeatures, type FeatureSelection } from "../features";
import { serializableBindings } from "../generationBindings";
import { worldGenerationSettings } from "../generationSettings";
import { MapRunner } from "../mapRunner";
import { landscape } from "../mapFixtures";
import type { GenerationState, MapProcess, ProcessConfiguration } from "../process";
import { atlasPhysicalProfile } from "./atlasProfile";
import { createField, type PhysicalField } from "./field";
import { createMesh } from "./mesh";
import { createWorldMesh } from "./worldMesh";
import { createAdaptiveWorldMesh } from "./adaptiveMesh";
import { secondsPerYear } from "./dimensions";
import { units } from "./math";
import { validateLandscape } from "./surface";
import { extractNativeGeography } from "./atlasFeatures";
import { preflight } from "../preflight";

const worldId = "2f6e0134-6017-4e80-9196-052a12218500";

function numericalState(map: PhysicalField, extent: [number, number, number, number]) {
  const state = landscape(),
    footprint = rectangle(extent);
  state.domain.world.id = state.domain.scope.worldId = worldId;
  state.domain.world.reference.domain = footprint;
  state.domain.world.layers = Object.fromEntries(builtinLayers().map((layer) => [layer.id, layer]));
  state.domain.world.epochs = [
    {
      id: "Provided landscape",
      duration: 1000,
      tectonics: 1,
      hydrology: 1,
      ice: 1,
      coasts: 1,
      temperature: 15,
      seaLevel: 0,
    },
  ];
  state.domain.world.humanEras = [];
  state.domain.world.magicSystems = [];
  state.domain.world.areas.area.footprint = state.domain.scope.footprint = footprint;
  state.surface = createGrid("reference-surface", state.domain.scope, 16, 16);
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    samples: new Int32Array(state.surface.active.length),
    fixed: [],
    inherited: false,
    sampling: { maximumSize: map.mesh.spacing, minimumSize: map.mesh.spacing, featureSamples: 2 },
  };
  state.facts.clear();
  return state;
}

function suppliedProducts(
  products: string[],
  initializes: { product: string; initializer: string }[] = []
): MapProcess {
  return {
    contract: {
      id: "fixture.supplied-products",
      version: "1",
      parameters: {},
      requires: [],
      produces: ["canonry:workspace", ...products.map((product) => `canonry:${product}`)],
      invalidates: [],
      initializes,
      workspaceOnly: true,
    },
    behavior: { kind: "initialize", initialize() {} },
    validate: () => [],
  };
}

const extractRivers: MapProcess = {
  contract: {
    id: "fixture.extract-rivers",
    version: "1",
    parameters: {},
    requires: ["canonry:RiverGeometry"],
    produces: ["fixture:river-geography"],
    invalidates: [],
  },
  behavior: { kind: "extract", extract: extractNativeGeography },
  validate: () => [],
};

async function runPhysical(
  state: GenerationState,
  names: string[],
  inputs: string[],
  selected: FeatureSelection = {}
) {
  const settings = worldGenerationSettings(state.domain.world);
  const features = resolveGenerationFeatures(
    atlasFeatureDefinitions,
    selected,
    {},
    {},
    ["physical"],
    settings as unknown as ParameterValues
  );
  const absent = atlasFeatureDefinitions.flatMap((feature) =>
    features.selection[feature.id].enabled ? [] : (feature.absent ?? [])
  );
  const registry = atlasRegistry(state.domain, {
    areaId: "area",
    domains: ["physical"],
    quality: "draft",
    seed: 73,
    features: selected,
    resolvedFeatures: features,
  })
    .register(suppliedProducts(inputs, absent))
    .register(extractRivers);
  const configuration: ProcessConfiguration = {
    id: "reference-feature-execution",
    version: 1,
    parameters: {},
    inputs: serializableBindings({
      seed: 73,
      quality: "draft",
      domains: ["physical"],
      parameters: features.parameters,
      features,
      settings,
    }),
    sequence: [
      "fixture.supplied-products",
      ...names.map((name) => (name.includes(".") ? name : `canonry.${name}`)),
    ].map((id) => {
      const contract = registry.contracts().find((contract) => contract.id === id)!;
      return { kind: "process", id, process: id, version: contract.version };
    }),
  };
  return new MapRunner(configuration, registry).run(state, { seed: "73", seedScope: "reference" });
}

function iceValley() {
  const map = createField(createMesh(4, 0)),
    profile = atlasPhysicalProfile();
  map.mesh.areas.fill(1000);
  map.BedrockElevation.fill(units(1000));
  map.Elevation.set(map.BedrockElevation);
  map.IceThickness.fill(100);
  map.GroundedIce.fill(1);
  map.IceFlux.fill(profile.GlacierFluxThreshold * 2);
  map.IceFlowTargets.set([1, 2, 3, -1]);
  return numericalState(map, [0, 0, 4000, 1000]);
}

it("executes coupled glacial erosion and deposition with one conserved material budget", async () => {
  const initial = iceValley(),
    before = initial.physical!.map.Elevation.slice();
  const output = await runPhysical(
    initial,
    ["glacial-erosion", "glacial-deposition"],
    ["Elevation", "LakeState", "LandIce", "IceFlow", "LandscapeHistory"]
  );
  const map = output.state.physical!.map;
  expect(map.Elevation.some((height, i) => height !== before[i])).toBe(true);
  expect(map.CumulativeGlacialErosion.some((cut) => cut > 0)).toBe(true);
  expect(map.CumulativeGlacialDeposition.some((deposit) => deposit > 0)).toBe(true);
  expect(map.SedimentSupply.every((load) => load === 0)).toBe(true);
  expect(map.SedimentProducedTotal).toBeGreaterThan(0);
  expect(map.SedimentDepositedTotal + map.SedimentExportedTotal).toBeCloseTo(
    map.SedimentProducedTotal,
    7
  );
  expect(() => validateLandscape(map)).not.toThrow();
  expect(initial.physical!.map.Elevation).toEqual(before);
});

function coast() {
  const extent: [number, number, number, number] = [0, 0, 100_000, 100_000];
  const map = createField(
    createAdaptiveWorldMesh(extent, { maximumSize: 3125, minimumSize: 3125 }, 0)
  );
  map.WaveExposure.fill(1000);
  map.CrustTypeCodes.fill(2);
  for (let i = 0; i < map.mesh.count; i++) {
    map.WaterKindCodes[i] = map.mesh.x[i] < 0 ? 1 : 0;
    map.BedrockElevation[i] = map.Elevation[i] = units(map.mesh.x[i] < 0 ? -100 : 100);
    if (map.WaterKindCodes[i] !== 0) continue;
    for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
      const j = map.mesh.neighbors[i * map.mesh.stride + edge];
      if (j >= 0 && map.mesh.x[j] < 0) map.ExternalCoastalForcing[i] = 500;
    }
  }
  return numericalState(map, extent);
}

it("executes external and natural coastal cutting through the shared material executor", async () => {
  const initial = coast(),
    before = initial.physical!.map.Elevation.slice();
  const output = await runPhysical(
    initial,
    ["external-coastal-forcing", "coastal-erosion-and-deposition"],
    ["Elevation", "Ocean", "Bathymetry", "OceanCurrents", "LandscapeHistory", "SedimentTransport"]
  );
  const map = output.state.physical!.map;
  expect(map.Elevation.some((height, i) => height !== before[i])).toBe(true);
  expect(map.ExternalCoastalForcingHistory.some((force) => force > 0)).toBe(true);
  expect(map.CumulativeCoastalErosion.some((cut) => cut > 0)).toBe(true);
  expect(map.ExternalCoastalForcing.every((force) => force === 0)).toBe(true);
  expect(map.SedimentProducedTotal).toBeGreaterThan(0);
  expect(
    Math.abs(map.SedimentDepositedTotal + map.SedimentExportedTotal - map.SedimentProducedTotal) /
      map.SedimentProducedTotal
  ).toBeLessThan(1e-9);
  expect(() => validateLandscape(map)).not.toThrow();
  expect(initial.physical!.map.Elevation).toEqual(before);
});

function catchment() {
  const extent: [number, number, number, number] = [-100_000, -100_000, 100_000, 100_000];
  const map = createField(createWorldMesh(extent, 1024, 0)),
    profile = atlasPhysicalProfile();
  map.WaterKindCodes.fill(1);
  map.Slope.fill(profile.ChannelReferenceSlope);
  const index = (u: number, inverted: boolean) =>
    map.mesh.indexes.get(`${u}:0:${Number(inverted)}`)!;
  const members = Array.from({ length: 12 }, (_, k) => [
    index(k - 6, false),
    index(k - 6, true),
  ]).flat();
  const outlet = index(6, false);
  members.forEach((cell, station) => {
    map.WaterKindCodes[cell] = 0;
    map.DrainageBasinIds[cell] = 1;
    map.FlowTargets[cell] = members[station + 1] ?? outlet;
    map.BedrockElevation[cell] = map.Elevation[cell] = units(500 - station);
    map.DrainageElevations[cell] = map.Elevation[cell];
    map.Runoff[cell] = ((1000 / members.length) * 1000 * secondsPerYear) / map.mesh.areas[cell];
  });
  return numericalState(map, extent);
}

it("publishes a dimensional river network without performing terrain incision", async () => {
  const initial = catchment(),
    before = initial.physical!.map.Elevation.slice();
  const output = await runPhysical(
    initial,
    ["river-network", "river-channel-geometry", "fixture.extract-rivers"],
    ["Elevation", "Lakes", "Runoff", "FlowRouting"]
  );
  const map = output.state.physical!.map,
    cells = [...map.RiverOrders.keys()].filter((i) => map.RiverOrders[i] > 0);
  expect(cells.length).toBeGreaterThan(1);
  expect(cells.every((i) => map.FlowAccumulation[i] > 0 && map.RiverWidth[i] > 0)).toBe(true);
  expect(cells.every((i) => Number.isFinite(map.RiverDepth[i]) && map.RiverDepth[i] > 0)).toBe(
    true
  );
  expect(map.Elevation).toEqual(before);
  expect(map.BedrockElevation).toEqual(before);
  expect(map.CumulativeFluvialErosion.every((cut) => cut === 0)).toBe(true);
  expect(map.SedimentProducedTotal).toBe(0);
  const rivers = Object.values(output.state.domain.world.features).filter(
    (feature) => feature.kind === "river"
  );
  expect(rivers.length).toBeGreaterThan(0);
  expect(
    rivers.every(
      (feature) =>
        Array.isArray(feature.attributes.discharges) &&
        feature.attributes.discharges.every(
          (value) => typeof value === "number" && Number.isFinite(value) && value > 0
        )
    )
  ).toBe(true);
  expect(Object.keys(output.state.domain.world.networkReaches ?? {}).length).toBe(rivers.length);
});

it("uses impact-contributed fracture state without executing a fault-network feature", async () => {
  const extent: [number, number, number, number] = [-500_000, -500_000, 500_000, 500_000];
  const initial = numericalState(createField(createWorldMesh(extent, 1024, 0)), extent),
    selected = {
      "physical.fractures": { enabled: false },
      "physical.volcanism": { enabled: false },
    };
  initial.physical!.map.Elevation.fill(units(500));
  initial.physical!.map.BedrockElevation.set(initial.physical!.map.Elevation);
  const output = await runPhysical(
    initial,
    ["impact-cratering", "geothermal"],
    ["Elevation", "LandscapeHistory", "TectonicProvinces", "FractureState"],
    selected
  );
  const map = output.state.physical!.map;
  expect(map.events.some((event) => event.kind === "impact")).toBe(true);
  expect(map.FractureConductance.some((value) => value > 0)).toBe(true);
  expect(map.faults).toEqual([]);
  expect(output.state.facts.has("canonry:FractureState")).toBe(true);
  expect(output.state.facts.has("canonry:Fractures")).toBe(false);
  const control = structuredClone(output.state);
  control.physical!.map.FractureConductance.fill(0);
  const comparison = await runPhysical(
    control,
    ["geothermal"],
    ["Elevation", "LandscapeHistory", "TectonicProvinces", "FractureState"],
    selected
  );
  expect(
    map.Geothermal.some((value, i) => value > comparison.state.physical!.map.Geothermal[i])
  ).toBe(true);
});

function allLandPressure() {
  const extent: [number, number, number, number] = [0, 0, 100_000, 100_000],
    state = numericalState(createField(createWorldMesh(extent, 1024, 0)), extent),
    map = state.physical!.map,
    pressure = structuredClone(canonryMagicPresets()[2]);
  pressure.features = [];
  state.domain.world.magicSystems = [pressure];
  state.physical!.inherited = true;
  map.OpenBoundary = true;
  map.SeaLevelInitialized = true;
  map.Elevation.fill(units(1000));
  map.BedrockElevation.set(map.Elevation);
  // These deliberately incorrect inputs must be replaced by the real kernels.
  map.WaterKindCodes.fill(1);
  map.WaterDepths.fill(units(100));
  map.BathymetricZoneCodes.fill(4);
  return state;
}

/** The magic pass that evaluates the Pressure preset, whichever phase it is bound to. */
const pressurePass = (state: GenerationState) =>
  `canonry.magic-${state.domain.world.magicSystems![0].phase}`;
function pressureRecipe(state: GenerationState, includeBathymetry = true) {
  const prepared = prepareAtlasGeneration(state.domain, {
    areaId: "area",
    domains: ["physical", "magic"],
    quality: "draft",
    seed: 73,
  });
  const registry = prepared.registry.register(suppliedProducts(["Elevation"]));
  const names = [
    "fixture.supplied-products",
    "canonry.ocean-connectivity",
    "canonry.ocean-distance",
    ...(includeBathymetry ? ["canonry.bathymetry"] : []),
    "canonry.magic-initialize",
    pressurePass(state),
  ];
  const configuration: ProcessConfiguration = {
    ...prepared.input.configuration!,
    id: "reference-known-empty-ocean",
    sequence: names.map((id) => ({
      kind: "process",
      id,
      process: id,
      version: registry.contracts().find((contract) => contract.id === id)!.version,
    })),
  };
  return { registry, configuration };
}

it("computes a valid empty ocean and bathymetry before finding no deep-ocean pressure sources", async () => {
  const initial = allLandPressure(),
    { registry, configuration } = pressureRecipe(initial);
  expect(preflight(configuration, registry)).toEqual([]);
  const output = await new MapRunner(configuration, registry).run(initial, {
    seed: "73",
    seedScope: "known-empty-ocean",
  });
  const map = output.state.physical!.map,
    pressure = output.state.physical!.magic!.fields[0];
  expect(map.WaterKindCodes.every((kind) => kind === 0)).toBe(true);
  expect(map.WaterDepths.every((depth) => depth === 0)).toBe(true);
  expect(map.BathymetricZoneCodes.every((zone) => zone === 0)).toBe(true);
  expect(output.state.facts.has("canonry:Ocean")).toBe(true);
  expect(output.state.facts.has("canonry:Bathymetry")).toBe(true);
  expect(pressure.definition.source).toBe("deep-ocean");
  expect(pressure.origins).toEqual([]);
  expect(pressure.source.every((value) => value === 0)).toBe(true);
  expect(pressure.intensity.every((value) => value === 0)).toBe(true);
  expect(output.state.facts.has(pressurePass(initial).replace("canonry.", "atlas:"))).toBe(true);
  expect(initial.physical!.map.BathymetricZoneCodes.every((zone) => zone === 4)).toBe(true);
});

it("rejects missing bathymetry before the pressure source operation can mutate magic", async () => {
  const initial = allLandPressure(),
    { registry, configuration } = pressureRecipe(initial, false);
  expect(preflight(configuration, registry)).toEqual([
    expect.objectContaining({
      code: "generation_prerequisite",
      severity: "error",
      invocation: pressurePass(initial),
      resource: "canonry:Bathymetry",
    }),
  ]);
  const started: string[] = [];
  await expect(
    new MapRunner(configuration, registry).run(initial, {
      seed: "73",
      seedScope: "missing-bathymetry",
      progress: (_path, _fraction, message) => started.push(message),
    })
  ).rejects.toThrow(`${pressurePass(initial)} requires fresh canonry:Bathymetry`);
  expect(started).toContain("Starting canonry.magic-initialize");
  expect(started).not.toContain(`Starting ${pressurePass(initial)}`);
  expect(initial.physical!.magic).toBeUndefined();
});
