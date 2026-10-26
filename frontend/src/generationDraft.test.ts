import { expect, it } from "vitest";
import { generationRecipeSchema, prepareAtlasGeneration } from "@atlas/generation";
import { createGrid, rectangle } from "@atlas/domain";
import {
  newGenerationDraft,
  draftPreview,
  draftWorldSnapshot,
  normalizeGenerationDraft,
  prepareDraft,
  setFeatureSetting,
  updateDraftDomains,
  updateFeature,
} from "./generationDraft";
import { createWorldSnapshot, listWorlds, registerWorldSnapshot, session } from "./atlasState";
import { updateEcologyEpoch } from "./generationDraftEpochs";

it("creates blank world data independently of generation feature dependencies", () => {
  let draft = newGenerationDraft();
  for (const id of Object.keys(draft.recipe.features!))
    draft = updateFeature(draft, id, { enabled: false });
  const before = listWorlds();
  const snapshot = draftWorldSnapshot(draft);
  expect(snapshot.world.id).toBe(draft.worldId);
  expect(snapshot.world.generations).toEqual([]);
  expect(listWorlds()).toEqual(before);
});

it("previews complete initial settings without publishing worlds or changing defaults", () => {
  let draft = newGenerationDraft();
  draft.recipe.seed = 73;
  draft = updateEcologyEpoch(draft, "Formation", { migration: 2 });
  const before = listWorlds();
  const preview = draftPreview(draft);
  expect(preview.diagnostics).toEqual([]);
  expect(listWorlds()).toEqual(before);
  expect(preview.source.world.id).toBe(draft.worldId);
  expect(draftPreview(draft).input.configuration).toEqual(preview.input.configuration);
  expect(draftPreview(draft).source.scope.areaId).toBe(preview.source.scope.areaId);
  const world = registerWorldSnapshot(preview.source);
  expect(session(world.id).snapshot.world.epochs[0].ecology?.migration).toBe(2);
  expect(draftPreview(newGenerationDraft()).input.settings?.epochs[0].ecology?.migration).toBe(1);
});

it("normalizes legacy process choices and values without changing the prepared request", () => {
  const draft = newGenerationDraft();
  const legacy = generationRecipeSchema.parse({
    ...draft.recipe,
    schemaVersion: 1,
    features: undefined,
    parameters: { ...draft.recipe.parameters, volcanism: 0.35 },
    processes: { "canonry.glacial-erosion": false, "canonry.glacial-deposition": false },
    settings: {
      ...draft.recipe.settings,
      epochs: draft.recipe.settings.epochs.map((epoch, i) =>
        i ? epoch : { ...epoch, ecology: { migration: 2 }, magicActivity: { fire: 0.6 } }
      ),
    },
  });
  const source = createWorldSnapshot(
    { ...draft, name: "New world", seed: legacy.seed, settings: legacy.settings },
    draft.worldId
  );
  const before = prepareAtlasGeneration(source, { ...legacy, areaId: source.scope.areaId });
  const normalized = normalizeGenerationDraft({ ...draft, recipe: legacy });
  const after = prepareDraft(normalized);
  expect(normalized.recipe.schemaVersion).toBe(2);
  expect(normalized.recipe.processes).toEqual({});
  expect(normalized.recipe.features!["physical.glacial-sculpting"].enabled).toBe(false);
  expect(normalized.recipe.features!["physical.volcanism"].settings!.volcanism).toBe(0.35);
  expect(after.input.configuration).toEqual(before.input.configuration);
  expect(after.diagnostics).toEqual(before.diagnostics);
});

it("preserves owned scalar and nested values when switching a feature off and on", () => {
  let draft = setFeatureSetting(newGenerationDraft(), "ecology.living", "vegetation", 0.6);
  draft = updateEcologyEpoch(draft, "Cold age", { migration: 2.4 });
  const before = structuredClone(draft.recipe.features!["ecology.living"]);
  draft = updateFeature(
    updateFeature(draft, "ecology.living", { enabled: false }),
    "ecology.living",
    { enabled: true }
  );
  expect(draft.recipe.features!["ecology.living"]).toEqual(before);
  expect(prepareDraft(draft).input.parameters!.vegetation).toBe(0.6);
});

it("starts a new world with cultural, political and built geography included", () => {
  const draft = newGenerationDraft();
  expect(draft.recipe.domains).toEqual(
    expect.arrayContaining(["physical", "magic", "cultural", "political", "built"])
  );
  const selection = prepareDraft(draft).input.resolvedFeatures!.selection;
  for (const id of ["human.cultures", "human.politics", "built.layout"])
    expect(selection[id].enabled, id).toBe(true);
});

it("preserves feature intent across domain gates and explicitly enables a new feature's domain", () => {
  let draft = updateDraftDomains(newGenerationDraft(), ["physical"]);
  expect(prepareDraft(draft).input.resolvedFeatures!.selection["human.cultures"].enabled).toBe(
    false
  );
  draft = updateFeature(draft, "human.cultures", { enabled: true });
  expect(draft.recipe.domains).toContain("cultural");
  expect(prepareDraft(draft).input.resolvedFeatures!.selection["human.cultures"].enabled).toBe(
    true
  );
});

it("keeps invalid owned values editable while preparation rejects them", () => {
  const invalid = setFeatureSetting(newGenerationDraft(), "physical.volcanism", "volcanism", -1);
  expect(invalid.recipe.features!["physical.volcanism"].settings!.volcanism).toBe(-1);
  expect(() => prepareDraft(invalid)).toThrow();
  const repaired = setFeatureSetting(invalid, "physical.volcanism", "volcanism", 0.4);
  expect(prepareDraft(repaired).input.parameters!.volcanism).toBe(0.4);
});

it("derives compatibility fields from owned values instead of treating them as another authority", () => {
  const draft = setFeatureSetting(newGenerationDraft(), "physical.volcanism", "volcanism", 0.4);
  draft.recipe.parameters.volcanism = 1.2;
  draft.recipe.settings.epochs[0].temperature = 99;
  const normalized = normalizeGenerationDraft(draft);
  expect(normalized.recipe.parameters.volcanism).toBe(0.4);
  expect(normalized.recipe.settings.epochs[0].temperature).toBe(15);
});

it("prepares a region using its actual area identity and complete source snapshot", () => {
  const draft = newGenerationDraft();
  const source = createWorldSnapshot({
    ...draft,
    name: "Parent world",
    seed: draft.recipe.seed,
    settings: draft.recipe.settings,
  });
  const parent = source.world.areas[source.scope.areaId];
  const child = {
    ...structuredClone(parent),
    id: crypto.randomUUID(),
    parentId: parent.id,
    profile: "region" as const,
    footprint: rectangle([1000, 1000, 100_000, 100_000]),
  };
  source.world.areas[child.id] = child;
  source.numerical.retained = createGrid("retained", source.scope, 2, 2);
  const prepared = prepareDraft(normalizeGenerationDraft(draft, source), source, child.id);
  expect(prepared.source.world.id).toBe(source.world.id);
  expect(prepared.source.scope.areaId).toBe(child.id);
  expect(prepared.source.scope.footprint).toEqual(child.footprint);
  expect(prepared.source.numerical).toEqual(source.numerical);
  expect(prepared.source.world.epochs).toEqual(source.world.epochs);
  expect(source.scope.areaId).toBe(parent.id);
});
