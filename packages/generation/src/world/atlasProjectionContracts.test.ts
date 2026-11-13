import { mapCommand } from "../processTraits";
import { expect, it } from "vitest";
import { residentBand } from "@atlas/domain";
import { MapRunner } from "../mapRunner";
import { MapProcessRegistry, type MapProcess } from "../process";
import { configuration, invoke, landscape, options } from "../mapFixtures";
import { preflight } from "../preflight";
import { atlasParametersSchema } from "../atlasParameters";
import type { AtlasGenerationInput } from "../atlasWorkflow";
import { physicalFeatureDefinitions } from "../physicalFeatures";
import { domainFeatureDefinitions } from "../domainFeatures";
import { atlasNativeProcesses } from "./atlasProcesses";
import { atlasPublicationDefinitions } from "./atlasPublications";
import { createTestField as createField } from "../rock/groundTestFixture";
import { createMesh } from "./mesh";
import { atlasPhysicalProfile } from "./atlasProfile";

function fixture(disabled: string[] = []) {
  const state = landscape();
  state.surface.channels = {};
  state.surface.units = {};
  state.facts = new Set(["atlas:workspace"]);
  const map = createField(createMesh(32, 0));
  map.Elevation.fill(1024);
  map.BedrockElevation.fill(1024);
  const input: AtlasGenerationInput = {
    areaId: "area",
    seed: 1,
    quality: "draft",
    domains: ["physical"],
    settings: { epochs: [], humanEras: [], magicSystems: [], confluences: [] },
    resolvedFeatures: {
      parameters: atlasParametersSchema.parse({}),
      diagnostics: [],
      selection: Object.fromEntries(
        [...physicalFeatureDefinitions, ...domainFeatureDefinitions].map((feature) => [
          feature.id,
          { enabled: !disabled.includes(feature.id), settings: {} },
        ])
      ),
    },
  };
  state.publications = atlasPublicationDefinitions(input);
  state.physical = {
    map,
    profile: atlasPhysicalProfile({}, {}, map.scale),
    samples: residentBand("int32", new Int32Array(state.surface.active.length)),
    grid: state.surface.coverage,
    fixed: [],
    inherited: false,
  };
  const registry = new MapProcessRegistry();
  for (const process of atlasNativeProcesses(input, state.domain)) registry.register(process);
  const inputs = {
    features: input.resolvedFeatures,
    settings: input.settings,
    domains: input.domains,
  };
  return { state, registry, inputs: JSON.parse(JSON.stringify(inputs)) };
}
function consumer(): MapProcess {
  return {
    contract: {
      id: "test.flow-reader",
      version: "1",
      parameters: {},
      requires: ["FlowAccumulation", "drainage"],
      produces: [],
      invalidates: [],
    },
    operation: mapCommand(
      "test.flow-reader",
      "event",
      (state) => {
        expect(state.surface.channels.FlowAccumulation).toBeDefined();
      },
      []
    ),
    validate: () => [],
  };
}
it("forcing projection produces its real inputs without inventing flow or drainage", async () => {
  const { state, registry, inputs } = fixture();
  const projector = registry.get("atlas.project-forcing", "1");
  const plan = { ...configuration([invoke(projector)]), inputs };
  const result = await new MapRunner(plan, registry).run(state, options);
  for (const product of [
    "Elevation",
    "geology",
    "FractureConductance",
    "NaturalTemperature",
    "NaturalRockResistance",
  ])
    expect(result.state.facts.has(product)).toBe(true);
  expect(result.state.surface.channels.NaturalRockResistance).toBeDefined();
  expect(result.state.surface.channels.NaturalTemperature).toBeDefined();
  for (const product of ["FlowAccumulation", "drainage"])
    expect(result.state.facts.has(product)).toBe(false);
  expect(result.state.surface.channels.FlowAccumulation).toBeUndefined();
  expect(result.state.surface.channels.FlowTargets).toBeUndefined();
  const reader = consumer();
  registry.register(reader);
  const invalid = { ...configuration([invoke(projector), invoke(reader)]), inputs };
  expect(preflight(invalid, registry, state.facts).map((error) => error.resource)).toEqual([
    "FlowAccumulation",
    "drainage",
  ]);
  const skipped = await new MapRunner(invalid, registry).run(state, options);
  expect(skipped.state.diagnostics).toEqual([
    expect.objectContaining({
      code: "stale_fact",
      resource: "FlowAccumulation",
      outcome: "skipped",
    }),
    expect.objectContaining({ code: "stale_fact", resource: "drainage", outcome: "skipped" }),
  ]);
});
it.each([true, false])(
  "full projection declares routing only when selected (%s)",
  async (routing) => {
    const { state, registry, inputs } = fixture(routing ? [] : ["water.routing"]);
    state.physical!.map.SurfaceWaterMonth0.fill(120);
    state.physical!.map.WaterRecharge.fill(9);
    const projector = registry.get("atlas.project", "1");
    const plan = { ...configuration([invoke(projector)]), inputs };
    const result = await new MapRunner(plan, registry).run(state, options);
    expect(result.state.facts.has("FlowAccumulation")).toBe(routing);
    expect(result.state.facts.has("drainage")).toBe(false);
    expect(Boolean(result.state.surface.channels.FlowAccumulation)).toBe(routing);
    expect(Boolean(result.state.surface.channels.SurfaceWaterMonth0)).toBe(routing);
    expect(Boolean(result.state.surface.channels.WaterRecharge)).toBe(routing);
    if (routing) {
      expect(result.state.surface.channels.SurfaceWaterMonth0!.get(0)).toBe(120);
      expect(result.state.surface.channels.WaterRecharge!.get(0)).toBe(9);
    }
    expect(result.state.surface.channels.FlowTargets).toBeUndefined();
  }
);

it("full projection declares geology and fracture only when it projects those selected channels", async () => {
  const { state, registry, inputs } = fixture(["physical.foundation", "physical.fractures"]);
  const projector = registry.get("atlas.project", "1");
  const result = await new MapRunner(
    { ...configuration([invoke(projector)]), inputs },
    registry
  ).run(state, options);
  expect(result.state.facts.has("Elevation")).toBe(
    Boolean(result.state.surface.channels.Elevation)
  );
  expect(result.state.facts.has("geology")).toBe(
    (["BedrockElevation", "RockResistance", "SedimentThickness"] as const).every((name) =>
      Boolean(result.state.surface.channels[name])
    )
  );
  expect(result.state.facts.has("FractureConductance")).toBe(
    Boolean(result.state.surface.channels.FractureConductance)
  );
});
