import { expect, it } from "vitest";
import { canonryConfluencePresets, confluenceEffective } from "@atlas/domain";
import { newGenerationDraft, prepareDraft } from "./generationDraft";
import { draftHumanEras, updateHumanEra } from "./generationHumanEras";
import {
  deleteDraftEpoch,
  draftEpochs,
  insertDraftEpoch,
  moveDraftEpoch,
  renameDraftEpoch,
  replaceDraftEpochs,
  setDraftMagicSystems,
  updateEcologyEpoch,
  updateMagicActivity,
  updatePhysicalEpoch,
} from "./generationDraftEpochs";

function configured() {
  let draft = updateEcologyEpoch(newGenerationDraft(), "Formation", {
    migration: 2.3,
    rainfall: 1.8,
  });
  draft = updateMagicActivity(draft, "Formation", "fire", 0.6);
  return updateMagicActivity(draft, "Formation", "pressure", 0.4);
}

it("renames shared epochs and both keyed regimes atomically", () => {
  const original = configured();
  const draft = renameDraftEpoch(original, "Formation", "Assembly");
  expect(draftEpochs(draft)[0]).toMatchObject({
    id: "Assembly",
    ecology: { migration: 2.3, rainfall: 1.8 },
    magicActivity: { fire: 0.6, pressure: 0.4 },
  });
  for (const [owner, key] of [
    ["ecology.living", "epochs"],
    ["magic.configured", "activity"],
  ]) {
    expect(draft.recipe.features![owner].configuration![key]).not.toHaveProperty("Formation");
    expect(draft.recipe.features![owner].configuration![key]).toHaveProperty("Assembly");
  }
  expect(draftEpochs(original)[0].id).toBe("Formation");
  expect(prepareDraft(draft).diagnostics).toEqual([]);
});

it("inserts defaults, preserves values when reordering and removes orphan regimes on deletion", () => {
  let draft = insertDraftEpoch(configured(), 1, "Transition");
  expect(draftEpochs(draft)[1]).toMatchObject({
    id: "Transition",
    duration: 1000,
    tectonics: 1,
    ecology: { migration: 1, rainfall: 1 },
    magicActivity: {},
  });
  draft = moveDraftEpoch(draft, "Formation", 2);
  expect(draftEpochs(draft)[2]).toMatchObject({
    id: "Formation",
    ecology: { migration: 2.3 },
    magicActivity: { fire: 0.6, pressure: 0.4 },
  });
  draft = deleteDraftEpoch(draft, "Formation");
  expect(draft.recipe.features!["ecology.living"].configuration!.epochs).not.toHaveProperty(
    "Formation"
  );
  expect(draft.recipe.features!["magic.configured"].configuration!.activity).not.toHaveProperty(
    "Formation"
  );
  expect(prepareDraft(draft).diagnostics).toEqual([]);
});

it("rebinds human regime references through renaming and deletion without changing the original", () => {
  let draft = updateHumanEra(newGenerationDraft(), 0, {
    politicalCapacity: 3,
    physicalEpoch: "Formation",
  });
  const original = structuredClone(draft);
  draft = renameDraftEpoch(draft, "Formation", "Assembly");
  expect(draftHumanEras(draft)[0]).toMatchObject({
    physicalEpoch: "Assembly",
    politicalCapacity: 3,
  });
  expect(draftHumanEras(original)[0].physicalEpoch).toBe("Formation");
  draft = deleteDraftEpoch(draft, "Assembly");
  expect(prepareDraft(draft).source.world.humanEras![0].physicalEpoch).toBeNull();
});

it("rejects duplicate names or deleting the last epoch without mutating the draft", () => {
  const draft = configured(),
    before = structuredClone(draft);
  expect(() => renameDraftEpoch(draft, "Formation", "Cold age")).toThrow();
  expect(draft).toEqual(before);
  const single = replaceDraftEpochs(draft, [draftEpochs(draft)[0]]);
  expect(() => deleteDraftEpoch(single, "Formation")).toThrow();
  expect(draftEpochs(single)).toHaveLength(1);
});

it("imports combined history presets into each configuration owner", () => {
  const draft = replaceDraftEpochs(newGenerationDraft(), [
    {
      ...draftEpochs(newGenerationDraft())[0],
      id: "Wet age",
      temperature: 24,
      ecology: { rainfall: 1.9, fire: 0.2 },
      magicActivity: { fire: 0.8 },
    },
  ]);
  expect(draft.recipe.features!["physical.lifecycle"].configuration!.epochs).toEqual([
    expect.objectContaining({ id: "Wet age", temperature: 24 }),
  ]);
  expect(draft.recipe.features!["physical.lifecycle"].configuration!.epochs).toEqual([
    expect.not.objectContaining({ ecology: expect.anything() }),
  ]);
  expect(prepareDraft(draft).source.world.epochs[0]).toMatchObject({
    ecology: { rainfall: 1.9, fire: 0.2 },
    magicActivity: { fire: 0.8 },
  });
});

it("edits physical and ecological values at their owners and permits correcting invalid values", () => {
  let draft = updatePhysicalEpoch(configured(), "Formation", { duration: -1 });
  expect(draftEpochs(draft)[0].duration).toBe(-1);
  expect(() => prepareDraft(draft)).toThrow();
  draft = updatePhysicalEpoch(draft, "Formation", { duration: 2500, temperature: 22 });
  draft = updateEcologyEpoch(draft, "Formation", { migration: 3.1 });
  expect(prepareDraft(draft).source.world.epochs[0]).toMatchObject({
    duration: 2500,
    temperature: 22,
    ecology: { migration: 3.1 },
  });
});

it("removes deleted magical system activity without discarding unrelated regimes", () => {
  const original = configured();
  const systems = original.recipe.settings.magicSystems.filter(
    (system) => system.id !== "pressure"
  );
  const draft = setDraftMagicSystems(original, systems);
  expect(draftEpochs(draft)[0].magicActivity).toEqual({ fire: 0.6 });
  expect(draftEpochs(draft)[0].ecology!.migration).toBe(2.3);
  expect(prepareDraft(draft).input.settings!.magicSystems).toEqual(systems);
});

it("keeps a system's removal visible and leaves the meetings that read it ineffective", () => {
  const original = configured();
  const systems = original.recipe.settings.magicSystems.filter((system) => system.id !== "fire");
  const draft = setDraftMagicSystems(original, systems);
  expect(draft.recipe.features!["magic.configured"].configuration!.magicSystems).toEqual(systems);
  expect(draftEpochs(draft)[0].magicActivity).toEqual({ pressure: 0.4 });
  // Meetings travel with any system list: one that reads the removed system simply never holds.
  const settings = prepareDraft(draft).input.settings!,
    effective = (settings.confluences ?? canonryConfluencePresets()).filter((confluence) =>
      confluenceEffective(confluence, settings.magicSystems)
    );
  expect(effective.length).toBeGreaterThan(0);
  expect(effective.every((confluence) => !confluence.systems.includes("fire"))).toBe(true);
});
