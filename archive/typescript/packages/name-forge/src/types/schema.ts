import { z } from "zod";

/**
 * Phonology Profile Schema
 * Controls sound inventory and allowed sequences
 */
export const PhonologyProfileSchema = z.object({
  // Immutable: phoneme inventories (from LLM bootstrap)
  consonants: z.array(z.string()).min(1).describe("Available consonant sounds"),
  vowels: z.array(z.string()).min(1).describe("Available vowel sounds"),
  syllableTemplates: z.array(z.string()).min(1).describe("Syllable patterns like CV, CVC, CVV"),
  forbiddenClusters: z.array(z.string()).optional().describe("Phoneme sequences to avoid"),
  favoredClusters: z
    .array(z.string())
    .optional()
    .describe("Phoneme sequences to boost probability"),

  // Tunable: numeric parameters (for optimization)
  consonantWeights: z
    .array(z.number().min(0))
    .optional()
    .describe("Weight for each consonant (defaults to uniform)"),
  vowelWeights: z
    .array(z.number().min(0))
    .optional()
    .describe("Weight for each vowel (defaults to uniform)"),
  templateWeights: z
    .array(z.number().min(0))
    .optional()
    .describe("Weight for each syllable template (defaults to uniform)"),
  lengthRange: z
    .tuple([z.number().int().min(1), z.number().int().min(1)])
    .refine(([min, max]) => min <= max, {
      message: "lengthRange min must be <= max",
    })
    .describe("Min and max syllable count"),
  favoredClusterBoost: z
    .number()
    .min(1)
    .optional()
    .describe("Multiplier for favored cluster probability (default: 2.0)"),

  // Pronounceability constraints
  maxConsonantCluster: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Maximum consonants in a row (default: 3)"),
  minVowelSpacing: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Maximum consonants between vowels (default: 3)"),
  sonorityRanks: z
    .record(z.string(), z.number())
    .optional()
    .describe("Sonority rank per phoneme (0=stop, 5=vowel)"),
});

/**
 * Morphology Profile Schema
 * Controls prefixes, suffixes, and word structure
 */
export const MorphologyProfileSchema = z.object({
  // Immutable: morpheme inventories (from LLM bootstrap)
  prefixes: z.array(z.string()).optional().describe("Available prefixes"),
  suffixes: z.array(z.string()).optional().describe("Available suffixes"),
  infixes: z.array(z.string()).optional().describe("Available infixes"),
  wordRoots: z.array(z.string()).optional().describe("Pre-defined word roots for compound names"),
  honorifics: z.array(z.string()).optional().describe("Titles and honorifics"),
  structure: z
    .array(z.string())
    .min(1)
    .describe('Structural patterns like "root", "root-suffix", "prefix-root-suffix"'),

  // Tunable: weights (for optimization)
  prefixWeights: z.array(z.number().min(0)).optional().describe("Weight for each prefix"),
  suffixWeights: z.array(z.number().min(0)).optional().describe("Weight for each suffix"),
  structureWeights: z
    .array(z.number().min(0))
    .optional()
    .describe("Weight for each structural pattern"),
});

/**
 * Style Rules Schema
 * Controls fine-grained stylistic transforms
 */
export const StyleRulesSchema = z.object({
  // Tunable: all style parameters (for optimization)
  apostropheRate: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Probability of inserting apostrophes (0-1, default: 0)"),
  hyphenRate: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Probability of inserting hyphens (0-1, default: 0)"),
  capitalization: z
    .enum(["title", "allcaps", "mixed", "lowercase"])
    .optional()
    .describe("Capitalization style (default: title)"),
  preferredEndings: z
    .array(z.string())
    .optional()
    .describe("Suffix patterns to boost in final selection"),
  preferredEndingBoost: z
    .number()
    .min(1)
    .optional()
    .describe("Multiplier for preferred ending probability (default: 2.0)"),
  rhythmBias: z
    .enum(["soft", "harsh", "staccato", "flowing", "neutral"])
    .optional()
    .describe("Overall phonetic rhythm preference (default: neutral)"),

  // Length preference (for optimization stability)
  targetLength: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Preferred average name length in characters (default: from samples)"),
  lengthTolerance: z
    .number()
    .positive()
    .optional()
    .describe("Acceptable deviation from target length (default: 3)"),
});

/**
 * Domain Selector Schema
 * Defines which entities this domain applies to
 */
export const AppliesToSchema = z.object({
  kind: z.array(z.string()).min(1).describe("Entity kinds this domain matches"),
  subKind: z.array(z.string()).optional().describe("Specific subtypes"),
  tags: z.array(z.string()).optional().describe("Required tags"),
});

/**
 * Complete Naming Domain Schema
 * Combines phonology, morphology, and style into a complete domain config
 */
export const NamingDomainSchema = z.object({
  id: z.string().describe("Unique domain identifier"),
  appliesTo: AppliesToSchema.describe("Entity matching criteria (kind, subKind, tags)"),
  phonology: PhonologyProfileSchema.describe("Sound generation rules"),
  morphology: MorphologyProfileSchema.describe("Word structure rules"),
  style: StyleRulesSchema.describe("Stylistic transforms"),
});

/**
 * Domain Collection Schema
 * For loading multiple domains from a single file
 */
export const DomainCollectionSchema = z.object({
  domains: z.array(NamingDomainSchema),
});

/**
 * Generation Request Schema
 * Input for generating names
 */
export const GenerationRequestSchema = z.object({
  kind: z.string().describe("Entity kind"),
  subKind: z.string().optional().describe("Entity subtype"),
  tags: z.array(z.string()).optional().describe("Entity tags (default: [])"),
  count: z.number().int().min(1).optional().describe("Number of names to generate (default: 1)"),
  seed: z.string().optional().describe("Seed for deterministic RNG"),
});

/**
 * Validation Config Schema
 * Configuration for domain validation (Phase 2)
 */
export const ValidationConfigSchema = z.object({
  requiredNames: z.number().int().min(1).describe("Target capacity for this domain"),
  sampleFactor: z.number().min(1).default(20).describe("Multiplier for sample size"),
  maxSampleSize: z.number().int().min(1).default(20000).describe("Hard cap on sample size"),

  // Diffuseness thresholds
  minNN_p5: z
    .number()
    .min(0)
    .max(1)
    .default(0.3)
    .describe("Minimum 5th percentile nearest-neighbor distance"),
  minShapeNN_p5: z
    .number()
    .min(0)
    .max(1)
    .default(0.2)
    .describe("Minimum 5th percentile shape distance"),

  // Separation thresholds
  minCentroidDistance: z
    .number()
    .min(0)
    .default(0.2)
    .describe("Minimum distance between domain centroids"),
});

/**
 * Optimization Config Schema
 * Configuration for ML-based optimization (Phase 3)
 */
export const OptimizationConfigSchema = z.object({
  algorithm: z
    .enum(["hillclimb", "sim_anneal", "cma-es", "ga", "bayes", "cluster"])
    .default("hillclimb")
    .describe("Optimization algorithm"),
  iterations: z.number().int().min(1).default(100).describe("Number of optimization iterations"),
  populationSize: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Population size for population-based methods"),

  // Fitness weights
  fitnessWeights: z
    .object({
      capacity: z.number().min(0).default(1),
      diffuseness: z.number().min(0).default(1),
      separation: z.number().min(0).default(1),
      style: z.number().min(0).default(0),
    })
    .default({
      capacity: 1,
      diffuseness: 1,
      separation: 1,
      style: 0,
    }),
});
