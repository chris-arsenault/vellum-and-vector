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
  cartography: z.enum(["site", "area", "course"]).optional(),
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
      sourceSpacing: finite.nonnegative().default(45_000),
      baseCost: positive.default(4),
      conductanceDivisor: positive.default(26),
      baseInput: finite.nonnegative().default(360),
      logScale: finite.nonnegative().default(66),
      iceRetention: positive.default(1200),
      coldRetentionDistance: positive.default(10_000),
      accumulationArea: positive.default(100_000_000),
      featureNoiseScale: positive.default(70_000),
      rayCount: z.number().int().nonnegative().default(1200),
      rayDistance: positive.default(4_400_000),
      coastalRayDistance: positive.default(1_300_000),
      wakeDistance: positive.default(1_900_000),
      beamWidth: positive.default(20_000),
      coastalSources: z.number().int().nonnegative().default(200),
      coastalSourceDistance: positive.default(100_000),
      wakeSources: z.number().int().nonnegative().default(260),
      coastalThreshold: finite.min(0).max(999).default(140),
      waveAmplification: finite.nonnegative().default(0.36),
      currentAmplification: finite.nonnegative().default(0.18),
      // Energy a ray loses per 10 km of open water; reflections cost more.
      rayDecay: finite.nonnegative().default(3),
      // Intensity a ray at 1,000 energy deposits on the cell it crosses per beam step.
      rayIntensity: finite.nonnegative().default(27.8),
      // Intensity a wake leaves along its track, before the activity scale.
      wakeStrength: finite.nonnegative().default(180),
      // Accumulated intensity (summed over epochs) after which a Fire conduit seals.
      conduitBudget: positive.default(2400),
    })
    .prefault({}),
  effects: z
    .object({
      heat: finite.default(0),
      iceMelt: finite.default(0),
      rockResistance: finite.default(0),
      coastalForcing: finite.nonnegative().default(0),
      // Fire: living processes run faster near the conduit; 0–1 at full intensity.
      quickening: finite.min(0).max(1).default(0),
      // Fire: conductance gained per epoch along an active conduit, in conductance units.
      conduitOpening: finite.min(0).max(1000).default(0),
      // Aurora: living processes slow and persist; 0–1 at full intensity.
      stillness: finite.min(0).max(1).default(0),
      // Aurora: share of ice ablation prevented by stored charge at full intensity; 0–1.
      icePersistence: finite.min(0).max(1).default(0),
      // Pressure: per-mille upwelling added where a ray shoals, per intensity unit.
      upwelling: finite.min(0).max(3).default(0),
      // Pressure: sea-surface temperature change per intensity unit on the upwelling band.
      seaSurface: finite.min(-1).max(1).default(0),
      // Pressure: sea-surface warming left in a wake, in native units (10 per °C).
      wakeWarming: finite.min(0).max(200).default(0),
      // Pressure: fog share on coasts facing an upwelling band; 0–1.
      fog: finite.min(0).max(1).default(0),
      vegetationGrowth: finite.min(-1).max(5).default(0),
      fire: finite.min(0).max(1).default(0),
      organicPreservation: finite.min(-3).max(3).default(0),
      animalToxicity: finite.min(0).max(1).default(0),
      seedDispersal: finite.min(-1).max(5).default(0),
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
  "biome",
  "treeCover",
  "wetlandCover",
  "peatCarbon",
  "oilCarbon",
  "ecologicalToxicity",
  "soilWater",
  "soilDepth",
  "grazers",
  "browsers",
  "upwelling",
  "quickening",
  "stillness",
  "fog",
  "noise",
  "intensity",
  "history",
  "source",
  "wake",
  "rogue",
  "coastalHistory",
  "firstEpoch",
  "coastalFirstEpoch",
  "stored",
  "sealed",
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
