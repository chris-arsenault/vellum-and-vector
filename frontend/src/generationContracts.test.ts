import { expect, it } from "vitest";
import {
  atlasFeatureDefinitions,
  projectGenerationSetup,
  atlasGenerationModules,
  type GenerationFeature,
  type GenerationModule,
} from "@atlas/generation";
import { valueRecordSchema } from "@atlas/domain";
import { newGenerationDraft, prepareDraft, updateFeature } from "./generationDraft";
import { projectInvalidDraft } from "./generationInvalidDraft";
import { rebindDraftEpochs } from "./generationEpochBindings";
import {
  draftEpochs,
  setDraftMagicSystems,
  renameDraftEpoch,
  deleteDraftEpoch,
} from "./generationDraftEpochs";
import {
  configurationFieldKey,
  generationFeatureAdapter,
  registerGenerationFeatureAdapter,
} from "./generationFeatureAdapters";
import { removedMagicParameterFields } from "./generationMagicControls";

it("keeps unrelated feature selection and controls current while a nested name is invalid", () => {
  const original = newGenerationDraft(),
    prepared = prepareDraft(original),
    previous = projectGenerationSetup(prepared);
  const systems = structuredClone(prepared.input.settings!.magicSystems);
  systems[0].name = "";
  let draft = setDraftMagicSystems(original, systems);
  draft = updateFeature(draft, "physical.impacts", { enabled: false });
  expect(() => prepareDraft(draft)).toThrow();
  let view = projectInvalidDraft(draft, previous, false)!;
  expect(view.features.find((entry) => entry.id === "physical.impacts")).toMatchObject({
    enabled: false,
    status: "off",
  });
  draft = updateFeature(draft, "physical.impacts", { enabled: true });
  view = projectInvalidDraft(draft, view, false)!;
  expect(view.features.find((entry) => entry.id === "physical.impacts")).toMatchObject({
    enabled: true,
  });
  expect(
    view.features
      .find((entry) => entry.id === "physical.impacts")!
      .settings.every((setting) => setting.active)
  ).toBe(true);
  expect(view.features.every((feature) => feature.invocationIds.length === 0)).toBe(true);
});

it("coordinates an additional epoch participant and retains unrelated nested configuration", () => {
  const definition: GenerationFeature = {
    ...atlasFeatureDefinitions[0],
    id: "test.succession",
    configurationPresentation: {
      applicability: "any",
      epochs: { path: "regimes", shape: "record" },
    },
  };
  const selection = {
    "test.succession": {
      enabled: true,
      configuration: {
        regimes: { Formation: { response: 2.3 }, Gone: { response: 8 } },
        classification: { threshold: 0.4 },
      },
    },
  };
  const epoch = { ...draftEpochs(newGenerationDraft())[0], id: "Assembly" };
  const renamed = rebindDraftEpochs(selection, [epoch], { Assembly: "Formation" }, [definition]);
  expect(renamed[definition.id].configuration).toEqual({
    regimes: { Assembly: { response: 2.3 } },
    classification: { threshold: 0.4 },
  });
  const inserted = rebindDraftEpochs(renamed, [epoch, { ...epoch, id: "Later" }], {}, [definition]);
  expect(inserted[definition.id].configuration!.regimes).toEqual({
    Assembly: { response: 2.3 },
    Later: {},
  });
  expect(selection["test.succession"].configuration.regimes).toHaveProperty("Gone");
});

it("registers an owned nested summary and field adapter without central dispatch changes", () => {
  const remove = registerGenerationFeatureAdapter({
    id: "test.succession",
    summarize: ({ current, previous }) =>
      current?.threshold !== previous?.threshold
        ? [{ label: "Succession threshold", value: String(current?.threshold) }]
        : [],
    fieldKey: (path) => `feature.test.succession.${path.join(".")}`,
  });
  try {
    const adapter = generationFeatureAdapter("test.succession")!;
    const settings = prepareDraft(newGenerationDraft()).input.settings!;
    expect(
      adapter.summarize!({
        current: { threshold: 2.7 },
        previous: { threshold: 1 },
        settings,
        baseline: settings,
      })
    ).toEqual([{ label: "Succession threshold", value: "2.7" }]);
    expect(adapter.fieldKey!(["threshold"], { threshold: 2.7 })).toBe(
      "feature.test.succession.threshold"
    );
  } finally {
    remove();
  }
});

it("clears only parameter buffers that stop applying after a source or feedback change", () => {
  const system = prepareDraft(newGenerationDraft()).input.settings!.magicSystems[0];
  // The vein origin's cores are placed by hand: its geothermal budget no longer applies.
  const next = {
    ...system,
    origins: system.origins.map((origin, index) =>
      index === 0 ? { ...origin, source: "placed" as const } : origin
    ),
  };
  expect(removedMagicParameterFields(system, next)).toContain(
    `magic.${system.id}.parameters.maximumSources`
  );
  expect(removedMagicParameterFields(system, next)).not.toContain(
    `magic.${system.id}.parameters.baseCost`
  );
  const coastal = { ...next, effects: { ...next.effects, coastalForcing: 1 } };
  expect(removedMagicParameterFields(coastal, next)).toEqual(
    expect.arrayContaining([
      `magic.${system.id}.parameters.coastalThreshold`,
      `magic.${system.id}.parameters.waveAmplification`,
    ])
  );
});

it("resolves declared config field paths to actual epoch and magic editor inputs", () => {
  const draft = newGenerationDraft(),
    view = projectGenerationSetup(prepareDraft(draft));
  const clock = view.features.find((feature) => feature.id === "physical.lifecycle")!;
  expect(configurationFieldKey(clock, ["epochs", 0, "duration"])).toBe(
    "feature.physical.lifecycle.epochs.Formation.duration"
  );
  expect(configurationFieldKey(clock, ["epochs"])).toBeUndefined();
  expect(configurationFieldKey(clock, ["epochs", 999, "duration"])).toBeUndefined();
  const magic = view.features.find((feature) => feature.id === "magic.configured")!;
  expect(configurationFieldKey(magic, ["magicSystems", 0, "effects", "heat"])).toBe(
    "magic.fire.effects.heat"
  );
  const ecology = view.features.find((feature) => feature.id === "ecology.living")!;
  expect(configurationFieldKey(ecology, ["epochs", "A.B age", "migration"])).toBe(
    "feature.ecology.living.epochs.A%2EB%20age.migration"
  );
  const cultures = view.features.find((feature) => feature.id === "human.cultures")!;
  expect(configurationFieldKey(cultures, ["eras", 0, "id"])).toBe("human.eras.0.name");
  expect(configurationFieldKey(cultures, ["eras"])).toBeUndefined();
});

it("uses a registered nested participant through real draft rename, removal and preparation", () => {
  const module: GenerationModule = {
    id: "test.workflow-epoch",
    features: [
      {
        id: "test.workflow-epoch",
        label: "Succession",
        domains: ["physical"],
        defaultEnabled: true,
        settings: {},
        processes: [],
        slots: [],
        contribute: () => [],
        configuration: valueRecordSchema,
        configurationFromLegacy: (settings) => ({
          regimes: Object.fromEntries(
            (settings.epochs as unknown as { id: string }[]).map((epoch) => [
              epoch.id,
              { response: 2.3 },
            ])
          ),
          classification: { threshold: 0.4 },
        }),
        configurationPresentation: {
          applicability: "any",
          epochs: { path: "regimes", shape: "record" },
        },
      },
    ],
  };
  atlasGenerationModules.register(module);
  try {
    let draft = renameDraftEpoch(newGenerationDraft(), "Formation", " Assembly ");
    draft = deleteDraftEpoch(draft, "Cold age");
    const prepared = prepareDraft(draft),
      view = projectGenerationSetup(prepared);
    const feature = view.features.find((entry) => entry.id === module.id)!;
    expect(feature.configuration).toEqual({
      regimes: { Assembly: { response: 2.3 }, Present: { response: 2.3 } },
      classification: { threshold: 0.4 },
    });
    expect(configurationFieldKey(feature, ["regimes", "Assembly", "response"])).toBe(
      "feature.test.workflow-epoch.epochs.Assembly.response"
    );
  } finally {
    atlasGenerationModules.unregister(module.id);
  }
});
