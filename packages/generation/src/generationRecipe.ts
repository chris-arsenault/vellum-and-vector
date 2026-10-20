import { z } from "zod";
import { atlasParametersSchema } from "./atlasParameters";
import { generationSettingsSchema, type GenerationSettings } from "./generationSettings";

export const generationRecipeSchema = z
  .object({
    schemaVersion: z.literal(1),
    seed: z.number().int(),
    quality: z.enum(["draft", "standard", "fine"]),
    domains: z.array(z.enum(["physical", "magic", "cultural", "political", "built"])).min(1),
    parameters: atlasParametersSchema,
    processes: z.record(z.string(), z.boolean()),
    settings: generationSettingsSchema,
  })
  .strict();
export type GenerationRecipe = Omit<z.infer<typeof generationRecipeSchema>, "settings"> & {
  settings: GenerationSettings;
};
