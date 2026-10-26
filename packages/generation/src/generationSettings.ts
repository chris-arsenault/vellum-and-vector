import { z } from "zod";
import { tectonicDefaultMyr } from "./canonry/tectonicControls";
import {
  ecologyEpochSchema,
  magicSystemSchema,
  validateMagicSystems,
  canonryMagicPresets,
  magicConfluenceSchema,
  validateMagicConfluences,
  canonryConfluencePresets,
  beforePresentEpoch,
  type World,
  type Epoch,
  type MagicSystem,
  type MagicConfluence,
} from "@atlas/domain";

const nonnegative = z.number().finite().nonnegative();
const strength = nonnegative.max(1);
/**
 * The default human history: one mobile round inside the epoch before the present, whatever
 * it is, then three settled eras that carry the world to the classic age, roughly medieval
 * approaching renaissance. Hearthfall settles the land; the Age of Crowns fills it and lets
 * kingdoms consolidate; the Lantern Age brings the high courts and the great roads. Political
 * capacity rises across them so reach and great works come late. Eras are a creator's choice
 * in the era form; these names are a starting point.
 */
export function defaultHumanEras(): NonNullable<World["humanEras"]> {
  return [
    {
      id: "Ice age",
      years: 400,
      physicalEpoch: beforePresentEpoch,
      mobility: 2,
      politicalCapacity: 0.2,
    },
    { id: "Hearthfall", years: 300, physicalEpoch: null, mobility: 1, politicalCapacity: 0.6 },
    { id: "Age of Crowns", years: 500, physicalEpoch: null, mobility: 0.8, politicalCapacity: 1.2 },
    { id: "Lantern Age", years: 300, physicalEpoch: null, mobility: 1, politicalCapacity: 1.5 },
  ];
}
export const generationEpochSchema = z
  .object({
    id: z.string().trim().min(1),
    duration: z.number().finite().positive().default(1000),
    tectonicDurationMyr: z.number().finite().nonnegative().default(tectonicDefaultMyr),
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
    confluences: z.array(magicConfluenceSchema).default(() => canonryConfluencePresets()),
  })
  .strict()
  .superRefine((settings, context) => {
    try {
      validateMagicConfluences(settings.confluences, settings.magicSystems);
    } catch (error) {
      context.addIssue({ code: "custom", path: ["confluences"], message: String(error) });
    }
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
  confluences: MagicConfluence[];
}
export function worldGenerationSettings(world: World) {
  return generationSettingsSchema.parse({
    epochs: world.epochs,
    humanEras: world.humanEras ?? [],
    magicSystems: world.magicSystems ?? canonryMagicPresets(),
    confluences: world.confluences ?? canonryConfluencePresets(),
  });
}
