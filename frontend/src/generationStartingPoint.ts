import { atlasFeatureDefinitions, atlasPresets, type AtlasParameters } from "@atlas/generation";
import { requireThat } from "@atlas/domain";
import { setFeatureSetting, type GenerationDraft } from "./generationDraft";

function startingValues(id: string) {
  const preset = atlasPresets[id];
  requireThat(preset, "landscape_start", "Choose a registered landscape starting point.");
  if (id !== "balanced") return Object.entries(preset.parameters);
  const foundation = atlasFeatureDefinitions.find(
    (feature) => feature.id === "physical.foundation"
  )!;
  return Object.entries(foundation.settings).map(
    ([key, definition]) => [key, definition.default] as const
  );
}

function ownedStartingValues(id: string) {
  return startingValues(id).map(([key, value]) => {
    const owners = atlasFeatureDefinitions.filter((feature) =>
      feature.legacyParameters?.includes(key as keyof AtlasParameters)
    );
    requireThat(
      owners.length === 1,
      "setting_owner",
      `Bind ${key} to one feature before offering it as a starting value.`
    );
    return { owner: owners[0].id, key, value: value! };
  });
}

export function startingPointMatches(draft: GenerationDraft, id: string) {
  return ownedStartingValues(id).every(
    ({ owner, key, value }) => draft.recipe.features?.[owner]?.settings?.[key] === value
  );
}

export function startingPointFields(id: string) {
  return ownedStartingValues(id).map(({ owner, key }) => `feature.${owner}.${key}`);
}

export function applyLandscapeStartingPoint(draft: GenerationDraft, id: string) {
  const fields: string[] = [];
  for (const { owner, key, value } of ownedStartingValues(id)) {
    draft = setFeatureSetting(draft, owner, key, value);
    fields.push(`feature.${owner}.${key}`);
  }
  return { draft, fields };
}
