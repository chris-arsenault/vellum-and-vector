import { expect, it } from "vitest";
import { newGenerationDraft, prepareDraft } from "./generationDraft";
import {
  addHumanEra,
  draftHumanEras,
  removeHumanEra,
  renameHumanEra,
  updateHumanEra,
} from "./generationHumanEras";

it("renames operative cultural eras while retaining their imported compatibility metadata", () => {
  const draft = newGenerationDraft();
  draft.recipe.settings.humanEras[0].physicalEpoch = "Cold age";
  draft.recipe.settings.humanEras[0].politicalCapacity = 2.5;
  const renamed = renameHumanEra(draft, 0, "Early settlement");
  const era = prepareDraft(renamed).source.world.humanEras![0];
  expect(era).toMatchObject({
    id: "Early settlement",
    physicalEpoch: "Cold age",
    politicalCapacity: 2.5,
    years: 200,
  });
  expect(draftHumanEras(draft)[0].id).toBe("Settlement");
});

it("keeps duration and mobility at their owner and permits independent correction", () => {
  const draft = updateHumanEra(newGenerationDraft(), 0, { years: -1 });
  expect(draftHumanEras(draft)[0].years).toBe(-1);
  expect(() => prepareDraft(draft)).toThrow();
  expect(
    prepareDraft(updateHumanEra(draft, 0, { years: 350, mobility: 0.7 })).source.world.humanEras![0]
  ).toMatchObject({ years: 350, mobility: 0.7 });
});

it("adds distinct eras and removes only the selected era and its metadata", () => {
  const draft = addHumanEra(newGenerationDraft());
  expect(draftHumanEras(draft)).toHaveLength(2);
  const before = structuredClone(draft);
  expect(() => renameHumanEra(draft, 1, "Settlement")).toThrow();
  expect(draft).toEqual(before);
  const removed = removeHumanEra(draft, 0);
  expect(draftHumanEras(removed)).toEqual([{ id: "Era 2", years: 200, mobility: 1 }]);
  expect(removed.recipe.settings.humanEras).toEqual([]);
});
