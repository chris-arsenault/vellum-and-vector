import { expect, it, vi } from "vitest";
import { z } from "zod";
import { builtinLayers, putChannel, rectangle } from "@atlas/domain";
import { atlasGenerationModules, type GenerationModule } from "./generationModules";
import {
  prepareAtlasGeneration,
  type generateAtlas,
  type AtlasGenerationInput,
} from "./atlasWorkflow";
import { publishGenerationProducts } from "./publication";
import { landscape } from "./mapFixtures";
import { sequenceStages } from "./sequence";

const survey: GenerationModule = {
  id: "test.survey.module",
  features: [
    {
      id: "test.survey",
      label: "Survey",
      domains: ["physical"],
      defaultEnabled: true,
      settings: {
        temperature: {
          label: "Survey temperature ratio",
          unit: "ratio",
          minimum: 0,
          maximum: 1,
          default: 0.5,
          step: 0.1,
          group: "ecology",
        },
      },
      configuration: z
        .object({ multiplier: z.number().positive(), title: z.string().min(1) })
        .strict(),
      configurationFromLegacy: () => ({ multiplier: 1, title: "Default survey" }),
      processes: ["test.survey.measure"],
      slots: ["present.products", "epoch.incision"],
      contribute: (slot, configuration) =>
        ["present.products", "epoch.incision"].includes(slot)
          ? [
              {
                kind: "process",
                id: "survey.measure",
                process: "test.survey.measure",
                version: "1",
                parameters: { multiplier: configuration!.multiplier },
              },
            ]
          : [],
    },
  ],
  processes: () => [
    {
      contract: {
        id: "test.survey.measure",
        version: "1",
        parameters: {
          temperature: { type: "number", unit: "ratio", required: true },
          multiplier: { type: "number", unit: "ratio", required: true },
        },
        requires: ["canonry:Elevation"],
        produces: ["test:survey"],
        invalidates: [],
      },
      behavior: {
        kind: "model-pass",
        applyPass(state, context) {
          putChannel(
            state.surface,
            "testSurvey",
            "ratio",
            new Float64Array(state.surface.active.length).fill(
              Number(context.parameters.temperature) * Number(context.parameters.multiplier)
            )
          );
          context.recordCause({
            kind: "domain",
            process: "test.survey.measure",
            subjects: [],
            description: "A registered survey model pass measured its requested product.",
          });
        },
      },
      validate: () => [],
    },
  ],
  publications: (input) => [
    {
      kind: "field",
      channel: "testSurvey",
      unit: "ratio",
      quantity: "intensive",
      publish: input.resolvedFeatures!.selection["test.survey"].enabled,
      layer: {
        ...builtinLayers().find((layer) => layer.id === "climate")!,
        id: "survey",
        name: "Survey",
        facts: ["testSurvey"],
        schema: {},
        generator: "physical",
      },
    },
  ],
};
function source() {
  const state = landscape(),
    footprint = rectangle([0, 0, 3_000_000, 2_000_000]);
  state.domain.world.id = state.domain.scope.worldId = "00112233-4455-6677-8899-aabbccddeeff";
  state.domain.scope.footprint = footprint;
  state.domain.world.reference.domain = footprint;
  state.domain.world.areas.area.footprint = footprint;
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
it("extends the real atlas recipe, runtime and new-layer publication by registering one module", async () => {
  atlasGenerationModules.register(survey);
  try {
    const snapshot = source();
    const request: AtlasGenerationInput = {
      areaId: "area",
      seed: 73,
      quality: "draft",
      domains: ["physical"],
      parameters: { temperature: 17 },
      features: {
        "ecology.living": { enabled: false },
        "test.survey": {
          settings: { temperature: 0.4 },
          configuration: { multiplier: 3, title: "Requested" },
        },
      },
      processes: {},
    };
    const prepared = prepareAtlasGeneration(snapshot, request);
    request.features!["test.survey"].settings!.temperature = 0.9;
    request.features!["test.survey"].configuration!.multiplier = 10;
    request.processes!["canonry.impact-cratering"] = false;
    expect(prepared.diagnostics).toEqual([]);
    expect(prepared.input.parameters!.temperature).toBe(17);
    expect(prepared.input.configuration!.inputs!.publications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: "testSurvey",
          layer: expect.objectContaining({ id: "survey" }),
        }),
      ])
    );
    const invocation = sequenceStages(prepared.input.configuration!.sequence).find(
      (stage) => stage.invocation?.process === "test.survey.measure"
    )!.invocation!;
    expect(invocation.feature).toBe("test.survey");
    const message = structuredClone({ snapshot, input: prepared.input });
    const completed = await runWorker(message);
    expect(
      completed.state.history[0].causes.some((cause) => cause.process === "test.survey.measure")
    ).toBe(true);
    expect(
      completed.state.surface.channels.testSurvey.every((value) => Math.abs(value - 1.2) < 1e-12)
    ).toBe(true);
    publishGenerationProducts(completed.state, "survey-run");
    expect(completed.state.domain.world.layers.survey.name).toBe("Survey");
    expect(completed.state.domain.world.fields.some((field) => field.layerId === "survey")).toBe(
      true
    );
    expect(completed.state.domain.coverage.some((coverage) => coverage.layerId === "survey")).toBe(
      true
    );
    expect(snapshot.world.layers.survey).toBeUndefined();
  } finally {
    vi.unstubAllGlobals();
    atlasGenerationModules.unregister(survey.id);
  }
}, 120000);

it("resolves feature-owned clock changes before deriving ecological and magical defaults", () => {
  const snapshot = source();
  const epoch = { ...snapshot.world.epochs[0], id: "New epoch" };
  const input: AtlasGenerationInput = {
    areaId: "area",
    seed: 73,
    quality: "draft",
    domains: ["physical"],
    features: { "physical.lifecycle": { configuration: { epochs: [epoch] } } },
  };
  const prepared = prepareAtlasGeneration(snapshot, input);
  expect(prepared.diagnostics).toEqual([]);
  expect(prepared.input.settings!.epochs.map((item) => item.id)).toEqual(["New epoch"]);
  input.features!["ecology.living"] = { configuration: { epochs: { misspelled: {} } } };
  expect(() => prepareAtlasGeneration(snapshot, input)).toThrow("existing epoch");
});

async function runWorker(message: {
  snapshot: ReturnType<typeof source>;
  input: AtlasGenerationInput;
}) {
  type Result = Awaited<ReturnType<typeof generateAtlas>>;
  const messages: { kind: string; error?: string; result?: Result }[] = [];
  const worker: {
    onmessage?: (event: MessageEvent) => Promise<void>;
    postMessage(message: unknown): void;
  } = {
    postMessage(value) {
      messages.push(structuredClone(value) as (typeof messages)[number]);
    },
  };
  vi.stubGlobal("self", worker);
  await import("../../../frontend/src/generation.worker");
  await worker.onmessage!({ data: message } as MessageEvent);
  expect(messages.filter((entry) => entry.kind === "failed")).toEqual([]);
  const completed = messages.find((entry) => entry.kind === "completed")?.result;
  expect(completed).toBeDefined();
  return completed!;
}
