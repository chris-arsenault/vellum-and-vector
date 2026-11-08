import {
  generationRecipeSchema,
  defaultAtlasParameters,
  prepareAtlasGeneration,
  atlasFeatureDefinitions,
  atlasGenerationModules,
  generationSettingsSchema,
  resolveGenerationFeatures,
  applyCartographicSelection,
  defaultWorldDimensions,
  defaultHumanEras,
  mapBoundaryName,
  inheritMapBoundary,
  isRegionalRefinement,
  prepareRegionalRefinement,
  type FeatureSelection,
  type GenerationRecipe,
} from "@atlas/generation";
import {
  canonryMagicPresets,
  requireThat,
  type DomainSnapshot,
  type ParameterValues,
} from "@atlas/domain";
import { createWorldSnapshot, defaultEpochs, worldScope } from "./worldCreation";

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
    ...defaultWorldDimensions,
    recipe: generationRecipeSchema.parse({
      schemaVersion: 3,
      seed: 104729,
      quality: "standard",
      domains: ["physical", "magic", "cultural", "political", "built"],
      parameters: defaultAtlasParameters,
      settings: {
        epochs: defaultEpochs(),
        humanEras: defaultHumanEras(),
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

/** Bind feature-owned configuration to the execution settings. */
export function normalizeGenerationRecipe(value: unknown): GenerationRecipe {
  const recipe = generationRecipeSchema.parse(value);
  const settings = atlasGenerationModules.prepareSettings(recipe.features ?? {}, recipe.settings);
  // Preserve selection intent while domains gate the prepared request separately.
  const domains = [...new Set(atlasFeatureDefinitions.flatMap((feature) => feature.domains))];
  const resolved = resolveGenerationFeatures(
    atlasFeatureDefinitions,
    recipe.features,
    recipe.parameters,
    domains,
    settings as unknown as ParameterValues
  );
  return {
    ...recipe,
    schemaVersion: 3,
    features: resolved.selection,
    parameters: resolved.parameters,
    settings: generationSettingsSchema.parse(
      atlasGenerationModules.bindSettings(resolved, settings)
    ),
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
    draft.recipe.schemaVersion === 3 && draft.recipe.features
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
  const input = { ...recipe, areaId: areaId ?? snapshot.scope.areaId };
  // An independent captured map is refined through the regional preparation.
  if (isRegionalRefinement(snapshot, input.areaId))
    return prepareRegionalRefinement(snapshot, input);
  return prepareAtlasGeneration(
    snapshot,
    source ? inheritMapBoundary(snapshot, input, true) : input
  );
}
/** Blank creation installs valid world data without composing a generation request. */
export function draftWorldSnapshot(draft: GenerationDraft) {
  const recipe = normalizeGenerationRecipe(draft.recipe);
  requireThat(draft.worldId, "draft_identity", "Normalize the world draft before creating it.");
  return createWorldSnapshot(
    {
      ...draft,
      name: draft.name || "New world",
      seed: recipe.seed,
      settings: recipe.settings,
      boundaryMode: mapBoundaryName(recipe.parameters.mapBoundary),
    },
    draft.worldId
  );
}
export const draftPreview = prepareDraft;
