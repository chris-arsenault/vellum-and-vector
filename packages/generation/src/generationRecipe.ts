import { z } from "zod";
import { atlasParametersSchema } from "./atlasParameters";
import { generationSettingsSchema, type GenerationSettings } from "./generationSettings";
import { featureSelectionSchema } from "./features";

export const generationRecipeSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    seed: z.number().int(),
    quality: z.enum(["draft", "standard", "fine"]),
    domains: z.array(z.enum(["physical", "magic", "cultural", "political", "built"])).min(1),
    parameters: atlasParametersSchema,
    processes: z.record(z.string(), z.boolean()),
    features: featureSelectionSchema.optional(),
    settings: generationSettingsSchema,
  })
  .strict();
export type GenerationRecipe = Omit<z.infer<typeof generationRecipeSchema>, "settings"> & {
  settings: GenerationSettings;
};
