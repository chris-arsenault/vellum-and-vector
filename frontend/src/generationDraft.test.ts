import { expect, it } from "vitest";
import { newGenerationDraft, draftPreview } from "./generationDraft";
import { createWorld, listWorlds, session } from "./atlasState";

it("previews complete initial settings without publishing worlds or changing defaults", () => {
  const draft = newGenerationDraft();
  draft.recipe.seed = 73;
  draft.recipe.settings.epochs[0].ecology = { migration: 2 };
  const before = listWorlds();
  const preview = draftPreview(draft);
  expect(preview.diagnostics).toEqual([]);
  expect(listWorlds()).toEqual(before);
  const world = createWorld({
    name: "Configured at creation",
    seed: draft.recipe.seed,
    width: draft.width,
    height: draft.height,
    settings: draft.recipe.settings,
  });
  expect(session(world.id).snapshot.world.epochs[0].ecology?.migration).toBe(2);
  expect(draftPreview(newGenerationDraft()).input.settings?.epochs[0].ecology?.migration).toBe(1);
});
