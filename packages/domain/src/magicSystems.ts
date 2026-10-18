import { z } from "zod";

const finite = z.number().finite();
const positive = finite.positive();
const condition = z.object({
  field: z.string().min(1),
  min: finite.optional(),
  max: finite.optional(),
  values: z.array(finite).optional(),
  salt: z.number().int().optional(),
  index: z.number().int().optional(),
});
// Alternatives of conjunctions: any group may seed or retain a feature region.
export const magicFeatureSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  priority: finite.default(1),
  seeds: z.array(z.array(condition).min(1)).min(1),
  retains: z.array(z.array(condition).min(1)).optional(),
});
export const magicSystemSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  enabled: z.boolean().default(true),
  source: z.enum(["geothermal", "cold", "deep-ocean", "placed"]),
  propagation: z.enum(["fracture", "cold-drainage", "ocean-rays", "radial"]),
  phase: z.enum(["climate", "post-glacial"]),
  strength: finite.nonnegative().default(1),
  parameters: z
    .object({
      sourceThreshold: finite.default(300),
      maximumSources: z.number().int().nonnegative().default(900),
      sourceSpacing: finite.nonnegative().default(4.5),
      baseCost: positive.default(4),
      conductanceDivisor: positive.default(26),
      baseInput: finite.nonnegative().default(360),
      logScale: finite.nonnegative().default(66),
      iceRetention: positive.default(1200),
      rayCount: z.number().int().nonnegative().default(1200),
      raySteps: z.number().int().positive().default(440),
      coastalSources: z.number().int().nonnegative().default(200),
      wakeSources: z.number().int().nonnegative().default(260),
      coastalThreshold: finite.min(0).max(999).default(140),
      waveAmplification: finite.nonnegative().default(0.36),
      currentAmplification: finite.nonnegative().default(0.18),
    })
    .prefault({}),
  effects: z
    .object({
      heat: finite.default(0),
      iceMelt: finite.default(0),
      rockResistance: finite.default(0),
      coastalForcing: finite.nonnegative().default(0),
    })
    .prefault({}),
  history: z
    .object({
      retention: finite.min(0).max(1).default(1),
      storage: finite.nonnegative().default(0),
      advect: z.boolean().default(true),
    })
    .prefault({}),
  features: z.array(magicFeatureSchema).default([]),
});
export type MagicSystem = z.infer<typeof magicSystemSchema>;
export type MagicFeatureRule = z.infer<typeof magicFeatureSchema>;
export type MagicCondition = z.infer<typeof condition>;

export const magicPhysicalFields = [
  "temperature",
  "ice",
  "elevation",
  "slope",
  "water",
  "moisture",
  "geothermal",
  "fracture",
  "landform",
  "river",
  "noise",
  "intensity",
  "history",
  "source",
  "wake",
  "rogue",
  "coastalHistory",
  "stored",
  "scatter",
] as const;

export function validateMagicSystems(systems: MagicSystem[]) {
  const ids = new Set(systems.map((system) => system.id));
  if (ids.size !== systems.length) throw new Error("Magic systems need distinct identities.");
  for (const system of systems)
    for (const rule of system.features)
      for (const group of [...rule.seeds, ...(rule.retains ?? [])])
        for (const test of group) {
          const known = magicPhysicalFields.some((field) => field === test.field);
          if (!known && !(test.field.startsWith("system:") && ids.has(test.field.slice(7))))
            throw new Error(`Unknown magic condition field: ${test.field}`);
        }
}
