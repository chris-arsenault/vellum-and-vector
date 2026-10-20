import { z } from "zod";
import {
  ecologyEpochSchema,
  magicSystemSchema,
  validateMagicSystems,
  canonryMagicPresets,
  type World,
  type Epoch,
  type MagicSystem,
} from "@atlas/domain";

const nonnegative = z.number().finite().nonnegative();
const strength = nonnegative.max(1);
export const generationEpochSchema = z
  .object({
    id: z.string().trim().min(1),
    duration: z.number().finite().positive().default(1000),
    tectonics: strength,
    hydrology: strength,
    ice: strength,
    coasts: strength,
    temperature: z.number().finite(),
    seaLevel: z.number().finite(),
    impacts: nonnegative.default(1),
    volcanism: nonnegative.default(1),
    magicActivity: z.record(z.string(), nonnegative).default({}),
    ecology: ecologyEpochSchema.strict().prefault({}),
  })
  .strict();
export const humanEraSchema = z
  .object({
    id: z.string().trim().min(1),
    years: z.number().finite().positive(),
    physicalEpoch: z.string().nullable(),
    mobility: nonnegative,
    politicalCapacity: nonnegative,
  })
  .strict();
export const generationSettingsSchema = z
  .object({
    epochs: z.array(generationEpochSchema).min(1),
    humanEras: z.array(humanEraSchema),
    magicSystems: z.array(magicSystemSchema),
  })
  .strict()
  .superRefine((settings, context) => {
    for (const [path, entries] of [
      ["epochs", settings.epochs],
      ["humanEras", settings.humanEras],
    ] as const) {
      if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
        context.addIssue({ code: "custom", path: [path], message: "Use unique history names." });
    }
    try {
      validateMagicSystems(settings.magicSystems);
    } catch (error) {
      context.addIssue({ code: "custom", path: ["magicSystems"], message: String(error) });
    }
  });
export interface GenerationSettings {
  epochs: Epoch[];
  humanEras: NonNullable<World["humanEras"]>;
  magicSystems: MagicSystem[];
}
export function worldGenerationSettings(world: World) {
  return generationSettingsSchema.parse({
    epochs: world.epochs,
    humanEras: world.humanEras ?? [],
    magicSystems: world.magicSystems ?? canonryMagicPresets(),
  });
}
