import type { GenerationSetup } from "./generationTypes";
import { atlasFeatureDefinitions } from "./generationPresentation";
import type { GenerationDraft } from "./generationDraft";

/** Keep form edits visible while the host rejects an incomplete configuration. */
export function projectInvalidDraft(draft: GenerationDraft, previous: GenerationSetup | null) {
  if (!previous) return null;
  const enabled = (id: string) => {
    const definition = atlasFeatureDefinitions.find((feature) => feature.id === id)!;
    return (
      Boolean(draft.recipe.features?.[id]?.enabled) &&
      definition.domains.some((domain) =>
        draft.recipe.domains.includes(domain as (typeof draft.recipe.domains)[number])
      )
    );
  };
  return {
    ...previous,
    features: previous.features.map((feature) => ({
      ...feature,
      enabled: enabled(feature.id),
      configuration: draft.recipe.features?.[feature.id]?.configuration,
      settings: feature.settings.map((setting) => ({
        ...setting,
        value: draft.recipe.features?.[setting.owner]?.settings?.[setting.key] ?? setting.value,
      })),
    })),
  };
}
