import type { FeatureSelection, GenerationRecipe } from "./generationTypes";
import { atlasFeatureDefinitions } from "./generationPresentation";

/** Creator form values. Validation, defaults and executable interpretation belong to the host. */
export interface GenerationDraft {
  worldId?: string;
  name: string;
  width: number;
  height: number;
  recipe: GenerationRecipe;
}
export function updateFeature(
  draft: GenerationDraft,
  id: string,
  patch: FeatureSelection[string]
): GenerationDraft {
  const definition = atlasFeatureDefinitions.find((feature) => feature.id === id);
  if (!definition) throw new Error(`Unknown generation feature ${id}.`);
  const previous = draft.recipe.features![id];
  const next = { ...previous, ...patch, settings: { ...previous.settings, ...patch.settings } };
  if (patch.configuration !== undefined)
    next.configuration = { ...previous.configuration, ...patch.configuration };
  const domains = [...draft.recipe.domains];
  if (patch.enabled && !domains.some((domain) => definition.domains.includes(domain)))
    domains.push(definition.domains[0] as GenerationRecipe["domains"][number]);
  return {
    ...draft,
    recipe: { ...draft.recipe, domains, features: { ...draft.recipe.features, [id]: next } },
  };
}
export function setFeatureSetting(draft: GenerationDraft, id: string, key: string, value: number) {
  return updateFeature(draft, id, { settings: { [key]: value } });
}
