import { expect, it } from "vitest";
import { canonryMagicPresets, generateChannel, putChannel, valueRecordSchema } from "@atlas/domain";
import { atlasConfiguration, prepareAtlasGeneration } from "./atlasWorkflow";
import { featureContribution, resolveGenerationFeatures, type GenerationFeature } from "./features";
import { physicalFeatureDefinitions } from "./physicalFeatures";
import { physicalFeatureSequence } from "./physicalFeatureSequence";
import { landscape } from "./mapFixtures";
import { MapRunner } from "./mapRunner";
import { MapProcessRegistry, type ProcessConfiguration } from "./process";
import { sequenceStages } from "./sequence";
import { nativeContracts } from "./canonry/contracts";
import { physicalSchedule } from "./canonry/schedule";
import { drainageSteps, glacialRunoffStep } from "./canonry/sequence";
import { atlasEpoch } from "./canonry/atlasProfile";
import { GenerationModuleRegistry, type GenerationModule } from "./generationModules";
import { atlasGenerationModules } from "./atlasModules";
import { worldGenerationSettings } from "./generationSettings";

it("translates legacy glacier choices into one whole feature and rejects a contradictory pair", () => {
  const disabled = resolveGenerationFeatures(
    physicalFeatureDefinitions,
    {},
    {
      "canonry.glacial-erosion": false,
      "canonry.glacial-deposition": false,
    },
    {},
    ["physical"],
    worldGenerationSettings(source().world) as unknown as import("@atlas/domain").ParameterValues
  );
  expect(disabled.selection["physical.glacial-sculpting"].enabled).toBe(false);
  expect(physicalFeatureSequence("epoch.sculpting", disabled)).toEqual([]);
  expect(physicalFeatureSequence("present.glacial-landforms", disabled)).toEqual([]);
  expect(() =>
    resolveGenerationFeatures(
      physicalFeatureDefinitions,
      {},
      {
        "canonry.glacial-erosion": false,
        "canonry.glacial-deposition": true,
      }
    )
  ).toThrow("one feature");
});

function source() {
  const state = landscape();
  state.domain.world.epochs = [
    {
      id: "Formation",
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
  return state.domain;
}

function coastalRequest(coastalForcing: number) {
  const domain = source(),
    pressure = structuredClone(canonryMagicPresets()[2]);
  pressure.effects.coastalForcing = coastalForcing;
  pressure.features = [];
  domain.world.magicSystems = [pressure];
  return prepareAtlasGeneration(domain, {
    areaId: domain.scope.areaId,
    seed: 73,
    quality: "draft",
    domains: ["physical", "magic"],
    features: { "physical.coastal-evolution": { enabled: false } },
  });
}

it("blocks pressure-driven coastal modification when its material target is disabled", () => {
  const prepared = coastalRequest(1);
  expect(prepared.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "feature_dependency",
      resource: "physical.coastal-evolution",
      severity: "error",
    })
  );
  expect(
    sequenceStages(prepared.input.configuration!.sequence).some((stage) =>
      ["canonry.external-coastal-forcing", "canonry.coastal-erosion-and-deposition"].includes(
        stage.invocation?.process ?? ""
      )
    )
  ).toBe(false);
});

it("retains a pressure field with no coastal modification and no coastal cutting", () => {
  const prepared = coastalRequest(0);
  expect(prepared.diagnostics).toEqual([]);
  expect(prepared.input.resolvedFeatures!.selection["magic.configured"].enabled).toBe(true);
  expect(prepared.input.settings!.magicSystems[0].effects.coastalForcing).toBe(0);
  expect(prepared.source.world.fields).toEqual([]);
  expect(prepared.source.numerical).toEqual({});
});

const survey: GenerationFeature = {
  id: "test.survey",
  label: "Reference survey",
  domains: ["physical"],
  defaultEnabled: true,
  settings: {
    threshold: {
      label: "Survey threshold",
      unit: "ratio",
      minimum: 0,
      maximum: 1,
      default: 0.5,
      step: 0.1,
      group: "ecology",
    },
  },
  processes: ["test.measure"],
  slots: ["present.products"],
  contribute: (slot) =>
    slot === "present.products"
      ? [{ kind: "process", id: "survey.measure", process: "test.measure", version: "1" }]
      : [],
};

it("registers and executes a feature-owned setting absent from the legacy parameter vocabulary", async () => {
  const resolved = resolveGenerationFeatures([survey], {
    "test.survey": { settings: { threshold: 0 } },
  });
  const registry = new MapProcessRegistry().register({
    contract: {
      id: "test.measure",
      version: "1",
      parameters: { threshold: { type: "number", unit: "ratio", required: true } },
      requires: [],
      produces: ["test:survey"],
      invalidates: [],
    },
    behavior: {
      kind: "model-pass",
      applyPass(state, context) {
        putChannel(
          state.surface,
          "survey",
          "ratio",
          generateChannel(state.surface, "survey", () => Number(context.parameters.threshold))
        );
      },
    },
    validate: () => [],
  });
  const configuration: ProcessConfiguration = {
    id: "test.survey",
    version: 1,
    parameters: resolved.selection["test.survey"].settings,
    sequence: survey.contribute("present.products"),
  };
  const result = await new MapRunner(configuration, registry).run(landscape(), {
    seed: "73",
    seedScope: "survey",
  });
  expect(Array.from(result.state.surface.channels.survey)).toEqual(Array(10).fill(0));
  expect(Object.hasOwn(resolved.parameters, "threshold")).toBe(false);
  expect(() =>
    resolveGenerationFeatures([survey], {
      "test.survey": { settings: { threshold: 2 } },
    })
  ).toThrow();
  expect(() =>
    resolveGenerationFeatures([survey], {
      "test.survey": { settings: { misspelled: 0.2 } },
    })
  ).toThrow("does not own");
});

it("namespaces equal module-local invocation identities by feature and causal slot", () => {
  const other = { ...survey, id: "test.other-survey" };
  const resolved = resolveGenerationFeatures([survey, other]);
  const sequence = [
    ...featureContribution(survey, "present.products", resolved),
    ...featureContribution(other, "present.products", resolved),
  ];
  expect(sequenceStages(sequence).map((stage) => stage.path)).toEqual([
    ["test.survey/present.products/survey.measure"],
    ["test.other-survey/present.products/survey.measure"],
  ]);
  expect(sequence.map((node) => node.kind === "process" && node.feature)).toEqual([
    "test.survey",
    "test.other-survey",
  ]);
});

it("preserves shared climate occurrence identities when an unrelated impact feature is omitted", () => {
  const domain = source(),
    input = { areaId: domain.scope.areaId, seed: 73, quality: "draft", domains: ["physical"] };
  const enabled = atlasConfiguration(domain, input),
    omitted = atlasConfiguration(domain, {
      ...input,
      features: { "physical.impacts": { enabled: false } },
    });
  const climateKeys = (configuration: ProcessConfiguration) =>
    sequenceStages(configuration.sequence)
      .filter((stage) => stage.invocation?.process === "canonry.temperature")
      .map((stage) => [...stage.epochs.map((epoch) => epoch.id), ...stage.path]);
  expect(climateKeys(enabled).length).toBeGreaterThan(1);
  expect(climateKeys(omitted)).toEqual(climateKeys(enabled));
});

function randomModule(id: string): GenerationModule {
  return {
    id,
    features: [
      {
        id,
        label: id,
        domains: ["physical"],
        defaultEnabled: true,
        settings: {},
        processes: [`${id}.measure`],
        slots: ["present.products"],
        contribute: (slot) =>
          slot === "present.products"
            ? [{ kind: "process", id: "measure", process: `${id}.measure`, version: "1" }]
            : [],
      },
    ],
    processes: () => [
      {
        contract: {
          id: `${id}.measure`,
          version: "1",
          parameters: {},
          requires: [],
          produces: [`${id}:measurement`],
          invalidates: [],
        },
        behavior: {
          kind: "model-pass",
          applyPass(state, context) {
            for (const persistent of [false, true])
              putChannel(
                state.surface,
                `${id}:${persistent ? "structure" : "variation"}`,
                "ratio",
                generateChannel(state.surface, `${id}:${persistent}`, () =>
                  context.random(persistent)
                )
              );
          },
        },
        validate: () => [],
      },
    ],
  };
}

function withProduct(
  module: GenerationModule,
  composition: "exclusive" | "additive" | "shared-state"
) {
  const factory = module.processes!;
  return {
    ...module,
    processes: (snapshot: Parameters<typeof factory>[0], input: Parameters<typeof factory>[1]) =>
      factory(snapshot, input).map((process) => ({
        ...process,
        contract: {
          ...process.contract,
          produces: [...process.contract.produces, "test:exclusive-product"],
          products: [{ id: "test:exclusive-product", lifetime: "run" as const, composition }],
        },
      })),
  };
}

it("rejects two exclusive feature providers before starting generation", () => {
  const modules = [randomModule("test.exclusive-a"), randomModule("test.exclusive-b")].map(
    (module) => withProduct(module, "exclusive")
  );
  for (const module of modules) {
    atlasGenerationModules.register(module);
  }
  try {
    const domain = source(),
      input = { areaId: domain.scope.areaId, seed: 73, quality: "draft", domains: ["physical"] },
      prepared = prepareAtlasGeneration(domain, input);
    expect(prepared.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "product_writer",
        resource: "test:exclusive-product",
        invocation: expect.stringContaining("test.exclusive-b"),
      })
    );
    expect(domain.world.fields).toEqual([]);
    expect(domain.numerical).toEqual({});
  } finally {
    for (const module of modules) atlasGenerationModules.unregister(module.id);
  }
});

it.each(["additive", "shared-state"] as const)(
  "accepts multiple feature contributors for a %s product",
  (composition) => {
    const modules = [randomModule("test.a"), randomModule("test.b")].map((module) =>
      withProduct(module, composition)
    );
    for (const module of modules) atlasGenerationModules.register(module);
    try {
      const prepared = prepareAtlasGeneration(source(), {
        areaId: "area",
        seed: 73,
        quality: "draft",
        domains: ["physical"],
      });
      expect(prepared.diagnostics).toEqual([]);
    } finally {
      for (const module of modules) atlasGenerationModules.unregister(module.id);
    }
  }
);

it("preserves both random streams when an unrelated module with the same local invocation name is added", async () => {
  async function run(modules: GenerationModule[]) {
    const registry = new GenerationModuleRegistry();
    for (const entry of modules) registry.register(entry);
    const resolved = resolveGenerationFeatures(registry.features()),
      state = landscape(),
      input = {
        areaId: state.domain.scope.areaId,
        seed: 73,
        quality: "draft",
        domains: ["physical"],
      };
    const processes = registry
      .processes(state.domain, input)
      .reduce((result, process) => result.register(process), new MapProcessRegistry());
    return new MapRunner(
      {
        id: "random-reference",
        version: 1,
        parameters: {},
        inputs: valueRecordSchema.parse(JSON.parse(JSON.stringify({ features: resolved }))),
        sequence: registry.contribute("present.products", resolved),
      },
      processes
    ).run(state, { seed: "73", seedScope: "module-composition" });
  }
  const a = randomModule("test.a"),
    b = randomModule("test.b"),
    alone = await run([a]),
    expanded = await run([b, a]);
  for (const stream of ["variation", "structure"]) {
    const samples = Array.from(alone.state.surface.channels[`test.a:${stream}`]);
    expect(new Set(samples).size).toBeGreaterThan(1);
    expect(Array.from(expanded.state.surface.channels[`test.a:${stream}`])).toEqual(samples);
    expect(expanded.state.surface.channels[`test.b:${stream}`]).toHaveLength(samples.length);
    expect(Array.from(expanded.state.surface.channels[`test.b:${stream}`])).not.toEqual(samples);
  }
});

it("retains reference numerical ordering including the atlas ecological water refreshes", () => {
  const domain = source(),
    input = { areaId: domain.scope.areaId, seed: 73, quality: "draft", domains: ["physical"] };
  const actual = sequenceStages(atlasConfiguration(domain, input).sequence)
    .flatMap((stage) =>
      stage.invocation ? [stage.invocation.process.slice("canonry.".length)] : []
    )
    .filter((name) => Object.hasOwn(nativeContracts, name));
  const expected = physicalSchedule(domain.world.epochs.map(atlasEpoch)).flatMap(
    ({ step, phase }) => {
      const refresh =
        phase === "hydrology" && step[0] === "ancestral-fluvial-erosion"
          ? drainageSteps
          : phase === "coasts" && step[0] === "external-coastal-forcing"
            ? [drainageSteps[0], glacialRunoffStep, ...drainageSteps.slice(1)]
            : [];
      return [...refresh.map(([name]) => name), step[0]];
    }
  );
  expect(actual).toEqual(expected);
});
