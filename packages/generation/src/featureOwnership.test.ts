import { expect, it } from "vitest";
import { z } from "zod";
import { canonryMagicPresets, type ParameterValues } from "@atlas/domain";
import { GenerationModuleRegistry } from "./generationModules";
import { resolveGenerationFeatures, type GenerationFeature } from "./features";
import { generationSettingsSchema } from "./generationSettings";

function feature(): GenerationFeature {
  return {
    id: "test.owner",
    label: "Owner",
    domains: ["physical"],
    defaultEnabled: true,
    settings: {},
    processes: ["test.owned"],
    slots: ["present.products"],
    contribute: () => [{ kind: "process", id: "owned", process: "test.owned", version: "1" }],
  };
}

it("rejects unsupported declared slots rather than silently dropping a feature", () => {
  const definition = feature();
  definition.slots = ["present.typo" as (typeof definition.slots)[number]];
  expect(() =>
    new GenerationModuleRegistry().register({ id: "test", features: [definition] })
  ).toThrow("Unknown causal slot");
});

it("rejects unowned processes within a contributed epoch", () => {
  const definition = feature();
  definition.contribute = () => [
    {
      kind: "epochs",
      id: "nested",
      resetFacts: [],
      epochs: [{ id: "epoch", duration: 1, parentEpoch: null, variables: {} }],
      body: [{ kind: "process", id: "unowned", process: "someone.else", version: "1" }],
    },
  ];
  const registry = new GenerationModuleRegistry().register({ id: "test", features: [definition] });
  expect(() =>
    registry.contribute("present.products", resolveGenerationFeatures([definition]))
  ).toThrow("cannot contribute unowned process someone.else");
});

it("applies configuration only to declared compatibility fields and isolates adapter mutations", () => {
  const definition = feature(),
    settings = generationSettingsSchema.parse({
      epochs: [
        {
          id: "Formation",
          duration: 1,
          tectonics: 1,
          hydrology: 1,
          ice: 1,
          coasts: 1,
          temperature: 15,
          seaLevel: 0,
        },
      ],
      humanEras: [],
      magicSystems: canonryMagicPresets(),
    });
  definition.configuration = z.object({ title: z.string() });
  definition.configurationFromLegacy = () => ({ title: "Configured" });
  definition.configurationBinding = {
    fields: ["humanEras"],
    bind: (_configuration, input) => {
      input.magicSystems.splice(0);
      return { humanEras: [] };
    },
  };
  const registry = new GenerationModuleRegistry().register({ id: "test", features: [definition] });
  const resolved = resolveGenerationFeatures(
    [definition],
    {},
    {},
    {},
    ["physical"],
    settings as unknown as ParameterValues
  );
  const before = structuredClone(settings);
  expect(registry.bindSettings(resolved, settings)).toEqual({ ...before, humanEras: [] });
  expect(settings).toEqual(before);
  definition.configurationBinding.bind = () => ({ magicSystems: [] });
  expect(() => registry.bindSettings(resolved, settings)).toThrow(
    "cannot configure unowned setting magicSystems"
  );
});

it("confines a shared-epoch adapter to its declared epoch fields", () => {
  const definition = feature(),
    settings = generationSettingsSchema.parse({
      epochs: [
        {
          id: "Formation",
          duration: 1,
          tectonics: 1,
          hydrology: 1,
          ice: 1,
          coasts: 1,
          temperature: 15,
          seaLevel: 0,
        },
      ],
      humanEras: [],
      magicSystems: [],
    });
  definition.configuration = z.object({});
  definition.configurationBinding = {
    fields: [],
    epochFields: ["ecology"],
    bind: (_configuration, previous) => ({
      epochs: previous.epochs.map((epoch) => ({
        ...epoch,
        ecology: { ...epoch.ecology, rainfall: 2 },
      })),
    }),
  };
  const registry = new GenerationModuleRegistry().register({ id: "test", features: [definition] });
  const resolved = resolveGenerationFeatures([definition], {
    [definition.id]: { configuration: {} },
  });
  expect(registry.bindSettings(resolved, settings).epochs[0].ecology?.rainfall).toBe(2);
  definition.configurationBinding.bind = (_configuration, previous) => ({
    epochs: previous.epochs.map((epoch) => ({ ...epoch, temperature: 100 })),
  });
  expect(() => registry.bindSettings(resolved, settings)).toThrow(
    "cannot configure unowned setting epochs"
  );
  expect(settings.epochs[0].temperature).toBe(15);
});
