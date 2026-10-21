import { expect, it } from "vitest";
import { newGenerationDraft, prepareDraft, updateFeature } from "./generationDraft";
import {
  updateEcologyEpoch,
  updateMagicActivity,
  updatePhysicalEpoch,
} from "./generationDraftEpochs";
import { updateHumanEra } from "./generationHumanEras";
import { generationFeatureAdapter } from "./generationFeatureAdapters";
import type { GenerationSettings } from "@atlas/generation";

function generationConfigurationChanges(
  feature: string,
  current: GenerationSettings,
  previous: GenerationSettings
) {
  return (
    generationFeatureAdapter(feature)?.summarize?.({
      current: {},
      previous: {},
      settings: current,
      baseline: previous,
    }) ?? []
  );
}

it("omits unchanged nested configuration and shows physical shifts in their displayed units", () => {
  const draft = newGenerationDraft(),
    baseline = prepareDraft(draft).input.settings!;
  expect(generationConfigurationChanges("physical.lifecycle", baseline, baseline)).toEqual([]);
  const changed = prepareDraft(
    updatePhysicalEpoch(draft, "Formation", { duration: 2500, temperature: 9, seaLevel: -30 })
  ).input.settings!;
  expect(generationConfigurationChanges("physical.lifecycle", changed, baseline)).toEqual([
    {
      label: "Formation",
      value: "duration 2500 years; temperature shift -6 °C; sea level offset -30 m",
    },
  ]);
});

it("shows resolved epoch rainfall even when biological generation is disabled", () => {
  const draft = newGenerationDraft(),
    baseline = prepareDraft(draft).input.settings!;
  const changed = updateEcologyEpoch(
    updateFeature(draft, "ecology.living", { enabled: false }),
    "Formation",
    { rainfall: 1.7, migration: 2.4 }
  );
  const settings = prepareDraft(changed).input.settings!;
  expect(generationConfigurationChanges("physical.climate", settings, baseline)).toEqual([
    { label: "Formation regime", value: "rainfall 1.7 ×" },
  ]);
  expect(generationConfigurationChanges("ecology.living", settings, baseline)[0].value).toContain(
    "migration and dispersal 2.4 ×"
  );
});

it("shows actual magical source/effect/activity values, including zero coastal forcing", () => {
  let draft = newGenerationDraft();
  const baseline = prepareDraft(draft).input.settings!;
  const systems = structuredClone(baseline.magicSystems);
  const pressure = systems.find((system) => system.id === "pressure")!;
  pressure.source = "placed";
  pressure.propagation = "radial";
  pressure.effects.coastalForcing = 0;
  pressure.parameters.sourceSpacing = 12345;
  pressure.features = [];
  draft = updateFeature(draft, "magic.configured", {
    configuration: { magicSystems: JSON.parse(JSON.stringify(systems)) },
  });
  draft = updateMagicActivity(draft, "Formation", "pressure", 0.4);
  const changes = generationConfigurationChanges(
    "magic.configured",
    prepareDraft(draft).input.settings!,
    baseline
  );
  const summary = changes.find((change) => change.label === pressure.name)!.value;
  expect(summary).toContain("source placed");
  expect(summary).toContain("propagation radial");
  expect(summary).toContain("coastal forcing 0×");
  expect(summary).toContain("source spacing 12345 m");
  expect(changes).toContainEqual({
    label: "Formation magical activity",
    value: `${pressure.name} 0.4×`,
  });
});

it("shows operative cultural edits without presenting compatibility metadata as an effect", () => {
  const draft = newGenerationDraft(),
    baseline = prepareDraft(draft).input.settings!;
  const changed = prepareDraft(updateHumanEra(draft, 0, { years: 375, mobility: 1.2 })).input
    .settings!;
  changed.humanEras[0].physicalEpoch = "Cold age";
  changed.humanEras[0].politicalCapacity = 7;
  expect(generationConfigurationChanges("human.cultures", changed, baseline)).toEqual([
    { label: "Settlement", value: "duration 375 years; mobility 1.2×" },
  ]);
});
