import { expect, it } from "vitest";
import { newGenerationDraft, prepareDraft } from "./generationDraft";
import {
  addHumanEra,
  draftHumanEras,
  removeHumanEra,
  renameHumanEra,
  updateHumanEra,
} from "./generationHumanEras";

// The default schedule is an ice-age round bound to the Cold age, then present settlement.
it("renames operative cultural eras while retaining their imported compatibility metadata", () => {
  const draft = newGenerationDraft();
  const shaped = updateHumanEra(draft, 1, { physicalEpoch: "Cold age", politicalCapacity: 2.5 });
  const renamed = renameHumanEra(shaped, 1, "Early settlement");
  const era = prepareDraft(renamed).source.world.humanEras![1];
  expect(era).toMatchObject({
    id: "Early settlement",
    physicalEpoch: "Cold age",
    politicalCapacity: 2.5,
    years: 200,
  });
  expect(draftHumanEras(draft).map((era) => era.id)).toEqual(["Ice age", "Settlement"]);
});

it("keeps duration and mobility at their owner and permits independent correction", () => {
  const draft = updateHumanEra(newGenerationDraft(), 1, { years: -1 });
  expect(draftHumanEras(draft)[1].years).toBe(-1);
  expect(() => prepareDraft(draft)).toThrow();
  expect(
    prepareDraft(updateHumanEra(draft, 1, { years: 350, mobility: 0.7 })).source.world.humanEras![1]
  ).toMatchObject({ years: 350, mobility: 0.7 });
});

it("clears a selected physical regime instead of restoring imported metadata", () => {
  const draft = newGenerationDraft();
  draft.recipe.settings.humanEras[0].physicalEpoch = "Formation";
  const cleared = updateHumanEra(draft, 0, { physicalEpoch: null });
  expect(prepareDraft(cleared).source.world.humanEras![0].physicalEpoch).toBeNull();
});

it("adds distinct eras and removes only the selected era and its metadata", () => {
  const draft = addHumanEra(newGenerationDraft());
  expect(draftHumanEras(draft)).toHaveLength(3);
  const before = structuredClone(draft);
  expect(() => renameHumanEra(draft, 2, "Settlement")).toThrow();
  expect(draft).toEqual(before);
  const removed = removeHumanEra(removeHumanEra(draft, 0), 0);
  expect(draftHumanEras(removed)).toEqual([
    { id: "Era 3", years: 200, mobility: 1, physicalEpoch: null, politicalCapacity: 1 },
  ]);
  expect(removed.recipe.settings.humanEras).toEqual([]);
});
