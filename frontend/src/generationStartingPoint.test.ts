import { expect, it } from "vitest";
import { newGenerationDraft, setFeatureSetting, updateFeature } from "./generationDraft";
import { draftEpochs, updateEcologyEpoch } from "./generationDraftEpochs";
import { applyLandscapeStartingPoint, startingPointMatches } from "./generationStartingPoint";

it("applies starting values at their owners while preserving switches, history and other settings", () => {
  let draft = updateFeature(newGenerationDraft(), "physical.impacts", { enabled: false });
  draft = setFeatureSetting(draft, "human.cultures", "cultureCount", 7);
  draft = setFeatureSetting(draft, "physical.volcanism", "volcanism", 0.6);
  draft = updateEcologyEpoch(draft, "Formation", { migration: 2 });
  const original = structuredClone(draft);
  const result = applyLandscapeStartingPoint(draft, "canonry");
  expect(result.draft.recipe.features!["physical.impacts"].enabled).toBe(false);
  expect(result.draft.recipe.features!["physical.impacts"].settings!.impacts).toBe(7);
  expect(result.draft.recipe.features!["human.cultures"].settings!.cultureCount).toBe(7);
  expect(result.draft.recipe.features!["physical.volcanism"].settings!.volcanism).toBe(0.6);
  expect(draftEpochs(result.draft)).toEqual(draftEpochs(original));
  expect(result.fields).toContain("feature.physical.climate.temperature");
  expect(result.fields).not.toContain("feature.physical.volcanism.volcanism");
  expect(startingPointMatches(result.draft, "canonry")).toBe(true);
  expect(draft).toEqual(original);
});

it("restores only foundation defaults for Mixed continents", () => {
  let draft = applyLandscapeStartingPoint(newGenerationDraft(), "islands").draft;
  draft = setFeatureSetting(draft, "physical.climate", "temperature", -5);
  const result = applyLandscapeStartingPoint(draft, "balanced");
  expect(result.draft.recipe.features!["physical.foundation"].settings!.continents).toBe(4);
  expect(result.draft.recipe.features!["physical.foundation"].settings!.landFraction).toBe(0.48);
  expect(result.draft.recipe.features!["physical.climate"].settings!.temperature).toBe(-5);
  expect(result.fields.every((field) => field.startsWith("feature.physical.foundation."))).toBe(
    true
  );
});
