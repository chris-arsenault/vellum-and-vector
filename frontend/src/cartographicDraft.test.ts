import { expect, it } from "vitest";
import { atlasGenerationModules, type CartographicControl } from "@atlas/generation";
import {
  newGenerationDraft,
  prepareDraft,
  setFeatureSetting,
  updateFeature,
} from "./generationDraft";
import {
  applyCartographicChoice,
  cartographicControls,
  cartographicValue,
  cartographicFieldPending,
} from "./cartographicDraft";

function control(id: string) {
  return cartographicControls().find((item) => item.id === id)!;
}
it("prepares every curated choice through the real schemas and dependency checker", () => {
  const base = updateFeature(newGenerationDraft(), "magic.configured", { enabled: false });
  for (const definition of cartographicControls())
    for (const choice of definition.choices) {
      const draft = applyCartographicChoice(base, definition, choice.id);
      const prepared = prepareDraft(draft);
      expect(
        prepared.diagnostics.filter((item) => item.severity === "error"),
        definition.id + ":" + choice.id
      ).toEqual([]);
      expect(cartographicValue(draft, definition)).toBe(choice.id);
    }
});
it("composes river geography without forcing incision or changing climate and identity", () => {
  const original = setFeatureSetting(newGenerationDraft(), "physical.climate", "temperature", 23);
  const draft = applyCartographicChoice(original, control("river-terrain"), "plains");
  const prepared = prepareDraft(draft);
  expect(draft.worldId).toBe(original.worldId);
  expect(draft.recipe.features?.["physical.climate"].settings?.temperature).toBe(23);
  expect(cartographicValue(draft, control("river-terrain"))).toBe("plains");
  expect(prepared.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  const stages = JSON.stringify(prepared.input.configuration!.sequence);
  expect(stages).toContain("river-floodplains");
  expect(stages).toContain("river-delta-formation");
  expect(stages).not.toContain("ancestral-fluvial-erosion");
});
it("keeps independent axes stable and displays Custom only for an affected control", () => {
  const errors = { "feature.physical.climate.temperature": "Enter a number." };
  expect(cartographicFieldPending(control("thermal-climate"), errors)).toBe(true);
  expect(cartographicFieldPending(control("rainfall-regime"), errors)).toBe(false);
  let draft = applyCartographicChoice(newGenerationDraft(), control("thermal-climate"), "warm");
  draft = applyCartographicChoice(draft, control("rainfall-regime"), "dry");
  expect(cartographicValue(draft, control("thermal-climate"))).toBe("warm");
  expect(cartographicValue(draft, control("rainfall-regime"))).toBe("dry");
  draft = setFeatureSetting(draft, "physical.climate", "temperature", 24);
  expect(cartographicValue(draft, control("thermal-climate"))).toBe("custom");
  expect(cartographicValue(draft, control("rainfall-regime"))).toBe("dry");
  draft = applyCartographicChoice(draft, control("thermal-climate"), "cold");
  expect(draft.recipe.features?.["physical.climate"].settings?.rainfall).toBe(0.2);
});
it("applies land arrangements without resetting event strengths or shared history", () => {
  const original = setFeatureSetting(newGenerationDraft(), "physical.volcanism", "volcanism", 0.6);
  const draft = applyCartographicChoice(original, control("land-arrangement"), "islands");
  expect(draft.recipe.features!["physical.foundation"].settings).toMatchObject({
    continents: 12,
    landFraction: 0.25,
  });
  expect(draft.recipe.features!["physical.volcanism"].settings!.volcanism).toBe(0.6);
  expect(draft.recipe.features!["physical.lifecycle"]).toEqual(
    original.recipe.features!["physical.lifecycle"]
  );
  expect(original.recipe.features!["physical.foundation"].settings!.continents).toBe(4);
});
it("preserves disabled strength for subsequent advanced edits and leaves cultures independent", () => {
  let draft = setFeatureSetting(
    newGenerationDraft(),
    "physical.glacial-sculpting",
    "glaciers",
    2.7
  );
  draft = applyCartographicChoice(draft, control("glacial-influence"), "ice");
  expect(draft.recipe.features?.["physical.glacial-sculpting"].settings?.glaciers).toBe(2.7);
  expect(draft.recipe.features?.["physical.land-ice"].enabled).toBe(true);
  draft = applyCartographicChoice(draft, control("cultural-geography"), "many");
  expect(cartographicValue(draft, control("political-geography"))).toBe("none");
  expect(prepareDraft(draft).input.parameters?.cultureCount).toBe(8);
});
it("discovers curated descriptors from a separately registered feature without primary raw-field promotion", () => {
  const descriptor: CartographicControl = {
    id: "test.custom-intent",
    label: "Survey intent",
    section: "environment",
    explanation: "Test registration",
    choices: [{ id: "off", label: "Omitted", features: { "test.intent": { enabled: false } } }],
  };
  atlasGenerationModules.register({
    id: "test.intent-module",
    features: [
      {
        id: "test.intent",
        label: "Survey",
        domains: ["physical"],
        defaultEnabled: false,
        settings: {},
        processes: [],
        slots: [],
        contribute: () => [],
        cartography: [descriptor],
      },
    ],
  });
  try {
    expect(cartographicControls()).toContain(descriptor);
    expect(cartographicValue(newGenerationDraft(), descriptor)).toBe("off");
  } finally {
    atlasGenerationModules.unregister("test.intent-module");
  }
});
