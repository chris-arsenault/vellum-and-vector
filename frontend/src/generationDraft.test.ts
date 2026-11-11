import {
  createWorldSnapshot,
  listWorlds,
  registerWorldSnapshot,
  fixtureState,
} from "./testSupport/workspaceFixture";
import { expect, it } from "vitest";
import { createGrid, rectangle } from "@atlas/domain";
import {
  newGenerationDraft,
  draftPreview,
  draftWorldSnapshot,
  normalizeGenerationDraft,
  prepareDraft,
  setFeatureSetting,
  updateFeature,
} from "./generationDraft";
import { updateEcologyEpoch } from "./generationDraftEpochs";

it("creates blank world data independently of generation feature dependencies", async () => {
  let draft = newGenerationDraft();
  for (const id of Object.keys(draft.recipe.features!))
    draft = updateFeature(draft, id, { enabled: false });
  const before = listWorlds();
  const snapshot = draftWorldSnapshot(draft);
  expect(snapshot.world.id).toBe(draft.worldId);
  expect(snapshot.world.generations).toEqual([]);
  expect(listWorlds()).toEqual(before);
});

it("previews complete initial settings without publishing worlds or changing defaults", async () => {
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
  expect(fixtureState(world.id).snapshot.world.epochs[0].ecology?.migration).toBe(2);
  expect(draftPreview(newGenerationDraft()).input.settings?.epochs[0].ecology?.migration).toBe(1);
});

it("preserves owned scalar and nested values when switching a feature off and on", async () => {
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

it("starts a new world with cultural, political and built geography included", async () => {
  const draft = newGenerationDraft();
  expect(draft.recipe.domains).toEqual(
    expect.arrayContaining(["physical", "magic", "cultural", "political", "built"])
  );
  const selection = prepareDraft(draft).input.resolvedFeatures!.selection;
  for (const id of ["human.cultures", "human.politics", "built.layout"])
    expect(selection[id].enabled, id).toBe(true);
});

it("preserves feature intent across domain gates and explicitly enables a new feature's domain", async () => {
  const base = newGenerationDraft();
  let draft = normalizeGenerationDraft({
    ...base,
    recipe: { ...base.recipe, domains: ["physical"] },
  });
  expect(prepareDraft(draft).input.resolvedFeatures!.selection["human.cultures"].enabled).toBe(
    false
  );
  draft = updateFeature(draft, "human.cultures", { enabled: true });
  expect(draft.recipe.domains).toContain("cultural");
  expect(prepareDraft(draft).input.resolvedFeatures!.selection["human.cultures"].enabled).toBe(
    true
  );
});

it("keeps invalid owned values editable while preparation rejects them", async () => {
  const invalid = setFeatureSetting(newGenerationDraft(), "physical.volcanism", "volcanism", -1);
  expect(invalid.recipe.features!["physical.volcanism"].settings!.volcanism).toBe(-1);
  expect(() => prepareDraft(invalid)).toThrow();
  const repaired = setFeatureSetting(invalid, "physical.volcanism", "volcanism", 0.4);
  expect(prepareDraft(repaired).input.parameters!.volcanism).toBe(0.4);
});

it("derives execution settings from feature-owned values", async () => {
  const draft = setFeatureSetting(newGenerationDraft(), "physical.volcanism", "volcanism", 0.4);
  draft.recipe.parameters.volcanism = 1.2;
  draft.recipe.settings.epochs[0].temperature = 99;
  const normalized = normalizeGenerationDraft(draft);
  expect(normalized.recipe.parameters.volcanism).toBe(0.4);
  expect(normalized.recipe.settings.epochs[0].temperature).toBe(15);
});

it("prepares a region using its actual area identity and complete source snapshot", async () => {
  const draft = newGenerationDraft();
  const source = createWorldSnapshot({
    ...draft,
    name: "Parent world",
    seed: draft.recipe.seed,
    settings: draft.recipe.settings,
  });
  const parent = source.world.areas[source.scope.areaId];
  // A region is an independent map; the draft is prepared through the regional preparation.
  const child = {
    ...structuredClone(parent),
    id: crypto.randomUUID(),
    parentId: parent.id,
    profile: "region" as const,
    footprint: rectangle([1000, 1000, 100_000, 100_000]),
    map: { sourceAreaId: parent.id, sourceRevision: 1, refinementLevel: 1 },
  };
  source.world.areas[child.id] = child;
  source.numerical.retained = createGrid("retained", source.scope, 2, 2);
  source.world.fields.push({
    id: "retained",
    areaId: child.id,
    layerId: "elevation",
    algorithm: "supplied",
    input: true,
    source: { kind: "operation", id: "supplied" },
    samples: 4,
    channels: [],
  });
  const prepared = prepareDraft(normalizeGenerationDraft(draft, source), source, child.id);
  expect(prepared.source.world.id).toBe(source.world.id);
  expect(prepared.source.scope.areaId).toBe(child.id);
  expect(prepared.source.scope.footprint).toEqual(child.footprint);
  expect(prepared.source.numerical).toEqual(source.numerical);
  expect(prepared.source.world.epochs).toEqual(source.world.epochs);
  expect(source.scope.areaId).toBe(parent.id);
});
