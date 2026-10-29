import { expect, it } from "vitest";
import { canonryMagicPresets, type ParameterValues } from "@atlas/domain";
import { atlasFeatureDefinitions, atlasRegistry, prepareAtlasGeneration } from "../atlasWorkflow";
import { resolveGenerationFeatures, type FeatureSelection } from "../features";
import { serializableBindings } from "../generationBindings";
import { worldGenerationSettings } from "../generationSettings";
import { MapRunner } from "../mapRunner";
import type { GenerationState, MapProcess, ProcessConfiguration } from "../process";
import { atlasPhysicalProfile } from "./atlasProfile";
import { createField } from "./field";
import { createMesh, TriangularLattice } from "./mesh";
import type { Band } from "@atlas/domain";
import { createWorldMesh } from "./worldMesh";
import { createAdaptiveWorldMesh } from "./adaptiveMesh";
import { secondsPerYear } from "./dimensions";
import { units } from "./math";
import { validateLandscape } from "./surface";
import { extractNativeGeography } from "./atlasFeatures";
import { preflight } from "../preflight";
import { numericalState } from "./physicalFeatureFixture";

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
      reconciliations: registry.reconciliations(),
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

const values = (band: Band) => Array.from(band);

function iceValley() {
  const map = createField(createMesh(4, 0)),
    profile = atlasPhysicalProfile();
  map.BedrockElevation.fill(units(1000));
  map.Elevation.copyFrom(map.BedrockElevation);
  map.IceThickness.fill(100);
  map.GroundedIce.fill(1);
  map.IceFlux.fill(profile.GlacierFluxThreshold * 2);
  [1, 2, 3, -1].forEach((target, i) => map.IceFlowTargets.set(i, target));
  return numericalState(map, [0, 0, 4000, 1000]);
}

it("executes coupled glacial erosion and deposition with one conserved material budget", async () => {
  const initial = iceValley(),
    before = values(initial.physical!.map.Elevation);
  const output = await runPhysical(
    initial,
    ["glacial-erosion", "glacial-deposition"],
    ["Elevation", "LakeState", "LandIce", "IceFlow", "LandscapeHistory"]
  );
  const map = output.state.physical!.map;
  expect(values(map.Elevation).some((height, i) => height !== before[i])).toBe(true);
  expect(values(map.CumulativeGlacialErosion).some((cut) => cut > 0)).toBe(true);
  expect(values(map.CumulativeGlacialDeposition).some((deposit) => deposit > 0)).toBe(true);
  expect(values(map.SedimentSupply).every((load) => load === 0)).toBe(true);
  expect(map.SedimentProducedTotal).toBeGreaterThan(0);
  expect(map.SedimentDepositedTotal + map.SedimentExportedTotal).toBeCloseTo(
    map.SedimentProducedTotal,
    7
  );
  expect(() => validateLandscape(map)).not.toThrow();
});

function coast() {
  const extent: [number, number, number, number] = [0, 0, 100_000, 100_000];
  const map = createField(
    createAdaptiveWorldMesh(extent, { maximumSize: 3125, minimumSize: 3125 }, 0)
  );
  map.WaveExposure.fill(1000);
  map.CrustTypeCodes.fill(2);
  for (let i = 0; i < map.mesh.count; i++) {
    map.WaterKindCodes.set(i, map.mesh.x(i) < 0 ? 1 : 0);
    const height = units(map.mesh.x(i) < 0 ? -100 : 100);
    map.BedrockElevation.set(i, height);
    map.Elevation.set(i, height);
    if (map.WaterKindCodes.get(i) !== 0) continue;
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      if (j >= 0 && map.mesh.x(j) < 0) map.ExternalCoastalForcing.set(i, 500);
    }
  }
  return numericalState(map, extent);
}

it("executes external and natural coastal cutting through the shared material executor", async () => {
  const initial = coast(),
    before = values(initial.physical!.map.Elevation);
  const output = await runPhysical(
    initial,
    ["external-coastal-forcing", "coastal-erosion-and-deposition"],
    ["Elevation", "Ocean", "Bathymetry", "OceanCurrents", "LandscapeHistory", "SedimentTransport"]
  );
  const map = output.state.physical!.map;
  expect(values(map.Elevation).some((height, i) => height !== before[i])).toBe(true);
  expect(values(map.ExternalCoastalForcingHistory).some((force) => force > 0)).toBe(true);
  expect(values(map.CumulativeCoastalErosion).some((cut) => cut > 0)).toBe(true);
  expect(values(map.ExternalCoastalForcing).every((force) => force === 0)).toBe(true);
  expect(map.SedimentProducedTotal).toBeGreaterThan(0);
  expect(
    Math.abs(map.SedimentDepositedTotal + map.SedimentExportedTotal - map.SedimentProducedTotal) /
      map.SedimentProducedTotal
  ).toBeLessThan(1e-9);
  expect(() => validateLandscape(map)).not.toThrow();
});

function catchment() {
  const extent: [number, number, number, number] = [-100_000, -100_000, 100_000, 100_000];
  const map = createField(createWorldMesh(extent, 1024, 0)),
    profile = atlasPhysicalProfile();
  map.WaterKindCodes.fill(1);
  map.Slope.fill(profile.ChannelReferenceSlope);
  const index = (u: number, inverted: boolean) =>
    (map.mesh as TriangularLattice).addressCell(u, 0, inverted);
  const members = Array.from({ length: 12 }, (_, k) => [
    index(k - 6, false),
    index(k - 6, true),
  ]).flat();
  const outlet = index(6, false);
  members.forEach((cell, station) => {
    map.WaterKindCodes.set(cell, 0);
    map.DrainageBasinIds.set(cell, 1);
    map.FlowTargets.set(cell, members[station + 1] ?? outlet);
    map.BedrockElevation.set(cell, units(500 - station));
    map.Elevation.set(cell, units(500 - station));
    map.DrainageElevations.set(cell, map.Elevation.get(cell));
    map.Runoff.set(cell, ((1000 / members.length) * 1000 * secondsPerYear) / map.mesh.area(cell));
  });
  return numericalState(map, extent);
}

it("publishes a dimensional river network without performing terrain incision", async () => {
  const initial = catchment(),
    before = values(initial.physical!.map.Elevation);
  initial.domain.world.areas.area.profile = "region";
  const output = await runPhysical(
    initial,
    ["river-network", "river-channel-geometry", "fixture.extract-rivers"],
    ["Elevation", "Lakes", "Runoff", "FlowRouting"]
  );
  const map = output.state.physical!.map,
    cells = Array.from({ length: map.mesh.count }, (_, i) => i).filter(
      (i) => map.RiverOrders.get(i) > 0
    );
  expect(cells.length).toBeGreaterThan(1);
  expect(cells.every((i) => map.FlowAccumulation.get(i) > 0 && map.RiverWidth.get(i) > 0)).toBe(
    true
  );
  expect(
    cells.every((i) => Number.isFinite(map.RiverDepth.get(i)) && map.RiverDepth.get(i) > 0)
  ).toBe(true);
  expect(values(map.Elevation)).toEqual(before);
  expect(values(map.BedrockElevation)).toEqual(before);
  expect(values(map.CumulativeFluvialErosion).every((cut) => cut === 0)).toBe(true);
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
  const selected = {
    "physical.fractures": { enabled: false },
    "physical.volcanism": { enabled: false },
  };
  // A run owns its state; the control repeats the same impacted run rather than copying it.
  const impacted = () => {
    const initial = numericalState(createField(createWorldMesh(extent, 1024, 0)), extent);
    initial.physical!.map.Elevation.fill(units(500));
    initial.physical!.map.BedrockElevation.copyFrom(initial.physical!.map.Elevation);
    return runPhysical(
      initial,
      ["impact-cratering", "geothermal"],
      ["Elevation", "LandscapeHistory", "TectonicProvinces", "FractureState"],
      selected
    );
  };
  const output = await impacted();
  const map = output.state.physical!.map;
  expect(map.events.some((event) => event.kind === "impact")).toBe(true);
  expect(values(map.FractureConductance).some((value) => value > 0)).toBe(true);
  expect(map.faults).toEqual([]);
  expect(output.state.facts.has("canonry:FractureState")).toBe(true);
  expect(output.state.facts.has("canonry:Fractures")).toBe(false);
  const control = (await impacted()).state;
  control.physical!.map.FractureConductance.fill(0);
  const comparison = await runPhysical(
    control,
    ["geothermal"],
    ["Elevation", "LandscapeHistory", "TectonicProvinces", "FractureState"],
    selected
  );
  expect(
    values(map.Geothermal).some(
      (value, i) => value > comparison.state.physical!.map.Geothermal.get(i)
    )
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
  map.BedrockElevation.copyFrom(map.Elevation);
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
  expect(values(map.WaterKindCodes).every((kind) => kind === 0)).toBe(true);
  expect(values(map.WaterDepths).every((depth) => depth === 0)).toBe(true);
  expect(values(map.BathymetricZoneCodes).every((zone) => zone === 0)).toBe(true);
  expect(output.state.facts.has("canonry:Ocean")).toBe(true);
  expect(output.state.facts.has("canonry:Bathymetry")).toBe(true);
  expect(pressure.definition.origins[0].source).toBe("deep-ocean");
  expect(pressure.located).toEqual([]);
  expect(values(pressure.source).every((value) => value === 0)).toBe(true);
  expect(values(pressure.intensity).every((value) => value === 0)).toBe(true);
  expect(output.state.facts.has(pressurePass(initial).replace("canonry.", "atlas:"))).toBe(true);
});

it("skips missing bathymetry before the pressure source operation can mutate magic", async () => {
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
  const result = await new MapRunner(configuration, registry).run(initial, {
    seed: "73",
    seedScope: "missing-bathymetry",
    progress: (_path, _fraction, message) => started.push(message),
  });
  expect(result.state.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "stale_fact",
      resource: "canonry:Bathymetry",
      outcome: "skipped",
      invocation: pressurePass(initial),
    })
  );
  expect(started).toContain("Starting canonry.magic-initialize");
  expect(started).not.toContain(`Starting ${pressurePass(initial)}`);
});
