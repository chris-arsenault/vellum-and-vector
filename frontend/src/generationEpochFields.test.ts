import { expect, it } from "vitest";
import {
  newGenerationDraft,
  prepareDraft,
  setFeatureSetting,
  updateFeature,
} from "./generationDraft";
import { atlasEpoch } from "../../packages/generation/src/canonry/atlasProfile";
import {
  changeEpochControl,
  epochControlValue,
  epochFieldPrefix,
  physicalEpochControls,
} from "./generationEpochFields";
import { draftEpochs } from "./generationDraftEpochs";
import { projectGenerationSetup } from "@atlas/generation";

it("edits temperature as the actual native offset relative to the shared 15-degree reference", () => {
  const original = setFeatureSetting(newGenerationDraft(), "physical.climate", "temperature", 24);
  const draft = changeEpochControl(original, "Formation", "temperature", -6);
  const control = physicalEpochControls("physical.climate").find(
    (field) => field.key === "temperature"
  )!;
  const epoch = draftEpochs(draft)[0];
  expect(epoch.temperature).toBe(9);
  expect(epochControlValue(epoch, control)).toBe(-6);
  expect(atlasEpoch(prepareDraft(draft).source.world.epochs[0]).TemperatureOffset).toBe(-60);
  expect(prepareDraft(draft).input.parameters!.temperature).toBe(24);
});

it("uses distinct raw-field namespaces for epoch names containing punctuation", () => {
  expect(epochFieldPrefix("ecology.living", "Age.1")).not.toBe(
    epochFieldPrefix("ecology.living", "Age")
  );
  expect(epochFieldPrefix("ecology.living", "Age.1")).not.toContain("Age.1");
});

it("keeps shared tectonic modulation reachable for mountains when plate evolution is off", () => {
  let draft = updateFeature(newGenerationDraft(), "physical.tectonic-history", { enabled: false });
  const control = physicalEpochControls("physical.mountains").find(
    (field) => field.key === "tectonics"
  )!;
  expect(control).toBeDefined();
  draft = changeEpochControl(draft, "Formation", control.key, 0.35);
  const prepared = prepareDraft(draft);
  expect(prepared.input.resolvedFeatures!.selection["physical.mountains"].enabled).toBe(true);
  expect(prepared.diagnostics).toEqual([]);
  expect(atlasEpoch(prepared.source.world.epochs[0]).TectonicStrength).toBe(350);
});

it("reads control descriptors from the projected feature without an identity-based UI table", () => {
  const view = projectGenerationSetup(prepareDraft(newGenerationDraft()));
  const climate = view.features.find((feature) => feature.id === "physical.climate")!;
  const control = climate.presentation.epochControls!.find((entry) => entry.key === "rainfall")!;
  expect(control).toMatchObject({ label: "Epoch rainfall", unit: "multiplier", min: 0, max: 5 });
  control.label = "Projected rainfall response";
  expect(physicalEpochControls(climate).find((entry) => entry.key === "rainfall")!.label).toBe(
    "Projected rainfall response"
  );
  expect(
    physicalEpochControls("physical.climate").find((entry) => entry.key === "rainfall")!.label
  ).toBe("Epoch rainfall");
});
