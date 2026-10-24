import {
  generationRecipeSchema,
  defaultAtlasParameters,
  prepareAtlasGeneration,
  atlasFeatureDefinitions,
  atlasGenerationModules,
  generationSettingsSchema,
  resolveGenerationFeatures,
  applyCartographicSelection,
  type FeatureSelection,
  type GenerationRecipe,
} from "@atlas/generation";
import {
  beforePresentEpoch,
  canonryMagicPresets,
  requireThat,
  type DomainSnapshot,
  type ParameterValues,
} from "@atlas/domain";
import { createWorldSnapshot, defaultEpochs, worldScope } from "./atlasState";

export interface GenerationDraft {
  worldId?: string;
  name: string;
  width: number;
  height: number;
  recipe: GenerationRecipe;
}
export function newGenerationDraft(): GenerationDraft {
  const draft = normalizeGenerationDraft({
    worldId: crypto.randomUUID(),
    name: "",
    width: 4_000_000,
    height: 3_000_000,
    recipe: generationRecipeSchema.parse({
      schemaVersion: 1,
      seed: 104729,
      quality: "standard",
      domains: ["physical", "magic", "built"],
      parameters: defaultAtlasParameters,
      processes: {},
      settings: {
        epochs: defaultEpochs(),
        humanEras: [
          {
            id: "Ice age",
            years: 400,
            physicalEpoch: beforePresentEpoch,
            mobility: 2,
            politicalCapacity: 0.2,
          },
          { id: "Settlement", years: 200, physicalEpoch: null, mobility: 1, politicalCapacity: 1 },
        ],
        magicSystems: canonryMagicPresets(),
      },
    }),
  });
  let features = draft.recipe.features!;
  for (const feature of atlasGenerationModules.features())
    for (const control of feature.cartography ?? []) {
      const reference = control.choices.find((choice) => choice.id === control.defaultChoice);
      if (reference) features = applyCartographicSelection(features, reference);
    }
  return normalizeGenerationDraft({ ...draft, recipe: { ...draft.recipe, features } });
}

/** Import compatibility once; subsequent edits belong to feature selections. */
export function normalizeGenerationRecipe(value: unknown): GenerationRecipe {
  const recipe = generationRecipeSchema.parse(value);
  const legacy = atlasGenerationModules.prepareSettings(recipe.features ?? {}, recipe.settings);
  // Preserve selection intent while domains gate the prepared request separately.
  const domains = [...new Set(atlasFeatureDefinitions.flatMap((feature) => feature.domains))];
  const resolved = resolveGenerationFeatures(
    atlasFeatureDefinitions,
    recipe.features,
    recipe.processes,
    recipe.parameters,
    domains,
    legacy as unknown as ParameterValues
  );
  return {
    ...recipe,
    schemaVersion: 2,
    features: resolved.selection,
    parameters: resolved.parameters,
    processes: {},
    settings: generationSettingsSchema.parse(atlasGenerationModules.bindSettings(resolved, legacy)),
  };
}

export function normalizeGenerationDraft(
  draft: GenerationDraft,
  source?: DomainSnapshot
): GenerationDraft {
  return {
    ...draft,
    worldId: source?.world.id ?? draft.worldId ?? crypto.randomUUID(),
    recipe: normalizeGenerationRecipe(draft.recipe),
  };
}

export function updateFeature(
  draft: GenerationDraft,
  id: string,
  patch: FeatureSelection[string]
): GenerationDraft {
  const normalized =
    draft.recipe.schemaVersion === 2 && draft.recipe.features
      ? draft
      : normalizeGenerationDraft(draft);
  const definition = atlasFeatureDefinitions.find((feature) => feature.id === id);
  requireThat(definition, "unknown_feature", `Unknown generation feature ${id}.`);
  const previous = normalized.recipe.features![id];
  const next = { ...previous, ...patch, settings: { ...previous.settings, ...patch.settings } };
  if (patch.configuration !== undefined)
    next.configuration = { ...previous.configuration, ...patch.configuration };
  const domains = [...normalized.recipe.domains];
  if (patch.enabled && !domains.some((domain) => definition.domains.includes(domain)))
    domains.push(definition.domains[0] as GenerationRecipe["domains"][number]);
  return {
    ...normalized,
    recipe: {
      ...normalized.recipe,
      domains,
      features: {
        ...normalized.recipe.features,
        [id]: next,
      },
    },
  };
}

export function setFeatureSetting(draft: GenerationDraft, id: string, key: string, value: number) {
  return updateFeature(draft, id, { settings: { [key]: value } });
}

export function updateDraftDomains(draft: GenerationDraft, domains: GenerationRecipe["domains"]) {
  return normalizeGenerationDraft({ ...draft, recipe: { ...draft.recipe, domains } });
}

export function prepareDraft(draft: GenerationDraft, source?: DomainSnapshot, areaId?: string) {
  const recipe = normalizeGenerationRecipe(draft.recipe);
  requireThat(
    source || draft.worldId,
    "draft_identity",
    "Normalize the world draft before reviewing it."
  );
  const snapshot = source
    ? { ...source, scope: worldScope(source.world, areaId ?? source.scope.areaId) }
    : draftWorldSnapshot(draft);
  return prepareAtlasGeneration(snapshot, { ...recipe, areaId: areaId ?? snapshot.scope.areaId });
}
/** Blank creation installs valid world data without composing a generation request. */
export function draftWorldSnapshot(draft: GenerationDraft) {
  const recipe = normalizeGenerationRecipe(draft.recipe);
  requireThat(draft.worldId, "draft_identity", "Normalize the world draft before creating it.");
  return createWorldSnapshot(
    { ...draft, name: draft.name || "New world", seed: recipe.seed, settings: recipe.settings },
    draft.worldId
  );
}
export const draftPreview = prepareDraft;
