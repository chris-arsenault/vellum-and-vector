import { z } from "zod";
import { atlasParametersSchema } from "./atlasParameters";
import { generationSettingsSchema, type GenerationSettings } from "./generationSettings";
import { featureSelectionSchema } from "./features";

export const generationRecipeSchema = z
  .object({
    schemaVersion: z.literal(3),
    seed: z.number().int(),
    quality: z.enum(["draft", "standard", "fine"]),
    domains: z.array(z.enum(["physical", "magic", "cultural", "political", "built"])).min(1),
    parameters: atlasParametersSchema,
    features: featureSelectionSchema.optional(),
    settings: generationSettingsSchema,
  })
  .strict();
export type GenerationRecipe = Omit<z.infer<typeof generationRecipeSchema>, "settings"> & {
  settings: GenerationSettings;
};
