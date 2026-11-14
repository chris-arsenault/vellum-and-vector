import { atlasFeatureDefinitions, type GenerationSetup } from "@atlas/generation";
import type { GenerationDraft } from "./generationDraft";

/** Keep editable intent current; an invalid request has no executable projection. */
export function projectInvalidDraft(
  draft: GenerationDraft,
  previous: GenerationSetup | null,
  historyFixed: boolean
) {
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
    features: previous.features.map((feature) => {
      const definition = atlasFeatureDefinitions.find((entry) => entry.id === feature.id)!;
      return {
        ...feature,
        enabled: enabled(feature.id),
        status:
          feature.status === "inherited"
            ? ("inherited" as const)
            : enabled(feature.id)
              ? ("unavailable" as const)
              : ("off" as const),
        reason:
          feature.status === "inherited"
            ? feature.reason
            : "Resolve the invalid configuration before generating.",
        configuration: draft.recipe.features?.[feature.id]?.configuration,
        configurationEditable:
          enabled(feature.id) &&
          Boolean(definition.configuration) &&
          (definition.configurationPresentation?.applicability === "any" || !historyFixed),
        settings: feature.settings.map((setting) => ({
          ...setting,
          value: draft.recipe.features?.[setting.owner]?.settings?.[setting.key] ?? setting.value,
          active:
            enabled(setting.controlFeature) &&
            !(historyFixed && definition.applicability?.initialOnlySettings?.includes(setting.key)),
        })),
        invocationIds: [],
      };
    }),
  };
}
