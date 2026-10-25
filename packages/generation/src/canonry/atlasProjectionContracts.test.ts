import { expect, it } from "vitest";
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
import { createField } from "./field";
import { createMesh } from "./mesh";
import { atlasPhysicalProfile } from "./atlasProfile";

function fixture(disabled: string[] = []) {
  const state = landscape();
  state.surface.channels = {};
  state.surface.units = {};
  state.facts = new Set(["canonry:workspace"]);
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
    profile: atlasPhysicalProfile(),
    samples: new Int32Array(state.surface.active.length),
    fixed: [],
    inherited: false,
    sampling: { maximumSize: 1000, minimumSize: 1000, featureSamples: 2 },
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
      requires: ["flow", "drainage"],
      produces: [],
      invalidates: [],
    },
    behavior: {
      kind: "model-pass",
      applyPass(state) {
        expect(state.surface.channels.flow).toBeDefined();
      },
    },
    validate: () => [],
  };
}
it("forcing projection produces its real inputs without inventing flow or drainage", async () => {
  const { state, registry, inputs } = fixture();
  const projector = registry.get("canonry.project-forcing", "0f62584c");
  const plan = { ...configuration([invoke(projector)]), inputs };
  const result = await new MapRunner(plan, registry).run(state, options);
  for (const product of ["elevation", "geology", "fracture", "naturalTemperature", "naturalRock"])
    expect(result.state.facts.has(product)).toBe(true);
  expect(result.state.surface.channels.naturalRock).toBeDefined();
  expect(result.state.surface.channels.naturalTemperature).toBeDefined();
  for (const product of ["flow", "drainage"]) expect(result.state.facts.has(product)).toBe(false);
  expect(result.state.surface.channels.flow).toBeUndefined();
  expect(result.state.surface.channels.receiver).toBeUndefined();
  const reader = consumer();
  registry.register(reader);
  const invalid = { ...configuration([invoke(projector), invoke(reader)]), inputs };
  expect(preflight(invalid, registry, state.facts).map((error) => error.resource)).toEqual([
    "flow",
    "drainage",
  ]);
  const skipped = await new MapRunner(invalid, registry).run(state, options);
  expect(skipped.state.diagnostics).toEqual([
    expect.objectContaining({ code: "stale_fact", resource: "flow", outcome: "skipped" }),
    expect.objectContaining({ code: "stale_fact", resource: "drainage", outcome: "skipped" }),
  ]);
});
it.each([true, false])(
  "full projection declares routing only when selected (%s)",
  async (routing) => {
    const { state, registry, inputs } = fixture(routing ? [] : ["water.routing"]);
    const projector = registry.get("canonry.project", "0f62584c");
    const plan = { ...configuration([invoke(projector)]), inputs };
    const result = await new MapRunner(plan, registry).run(state, options);
    expect(result.state.facts.has("flow")).toBe(routing);
    expect(result.state.facts.has("drainage")).toBe(false);
    expect(Boolean(result.state.surface.channels.flow)).toBe(routing);
    expect(result.state.surface.channels.receiver).toBeUndefined();
  }
);

it("full projection declares geology and fracture only when it projects those selected channels", async () => {
  const { state, registry, inputs } = fixture(["physical.foundation", "physical.fractures"]);
  const projector = registry.get("canonry.project", "0f62584c");
  const result = await new MapRunner(
    { ...configuration([invoke(projector)]), inputs },
    registry
  ).run(state, options);
  expect(result.state.facts.has("elevation")).toBe(
    Boolean(result.state.surface.channels.elevation)
  );
  expect(result.state.facts.has("geology")).toBe(
    ["bedrock", "rock", "sediment"].every((name) => Boolean(result.state.surface.channels[name]))
  );
  expect(result.state.facts.has("fracture")).toBe(Boolean(result.state.surface.channels.fracture));
});
