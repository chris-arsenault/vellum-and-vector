import { z } from "zod";

export const atlasParametersSchema = z.object({
  continents: z.number().int().min(1).max(30).default(4),
  provinces: z.number().int().min(2).max(200).default(42),
  landFraction: z.number().min(0.05).max(0.95).default(0.48),
  temperature: z.number().min(-50).max(60).default(15),
  rainfall: z.number().min(0).max(5).default(1),
  erosion: z.number().min(0).max(5).default(1),
  seaLevel: z.number().min(-5000).max(5000).default(0),
  impacts: z.number().int().nonnegative().default(6),
  impactSize: z.number().positive().default(1),
  volcanism: z.number().nonnegative().default(1),
  plateDrift: z.number().nonnegative().default(1),
  glaciers: z.number().nonnegative().default(1),
  coastalErosion: z.number().nonnegative().default(1),
  vegetation: z.number().min(0).max(5).default(1),
  grazing: z.number().min(0).max(5).default(1),
  cultureCount: z.number().int().min(1).default(3),
  polityCount: z.number().int().min(1).default(3),
});
export type AtlasParameters = z.infer<typeof atlasParametersSchema>;
export const defaultAtlasParameters = atlasParametersSchema.parse({});
