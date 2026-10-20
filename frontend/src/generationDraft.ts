import {
  generationRecipeSchema,
  defaultAtlasParameters,
  prepareAtlasGeneration,
  type GenerationRecipe,
} from "@atlas/generation";
import { canonryMagicPresets, type DomainSnapshot } from "@atlas/domain";
import { createWorldSnapshot, defaultEpochs } from "./atlasState";

export interface GenerationDraft {
  name: string;
  width: number;
  height: number;
  recipe: GenerationRecipe;
}
export function newGenerationDraft(): GenerationDraft {
  return {
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
          { id: "Settlement", years: 200, physicalEpoch: null, mobility: 1, politicalCapacity: 1 },
        ],
        magicSystems: canonryMagicPresets(),
      },
    }),
  };
}
export function draftPreview(draft: GenerationDraft, source?: DomainSnapshot, areaId?: string) {
  const recipe = generationRecipeSchema.parse(draft.recipe);
  const snapshot =
    source ??
    createWorldSnapshot(
      { ...draft, name: draft.name || "New world", seed: recipe.seed, settings: recipe.settings },
      "00000000-0000-4000-8000-000000000001"
    );
  return prepareAtlasGeneration(snapshot, { ...recipe, areaId: areaId ?? snapshot.scope.areaId });
}
