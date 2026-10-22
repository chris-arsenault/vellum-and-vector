import { z } from "zod";
import type { GenerationFeature, ResolvedFeatures } from "./features";
import { physicalProfile } from "./canonry/profile";

/** Only the existing coefficients used by curated outcomes are configurable here. */
const owners = {
  "physical.foundation": [
    "ContinentalAssemblySeparationDepth",
    "ContinentalWarpStrength",
    "InteriorReliefStrength",
    "ElevationVariationStrength",
  ],
  "physical.tectonic-history": ["EpochTectonicElevationStep"],
  "physical.mountains": [
    "InitialOrogenicConstructionStep",
    "EpochOrogenicConstructionStep",
    "OrogenicProminenceMinimum",
    "OrogenicProminenceMaximum",
    "OrogenicRootBudgetMinimum",
    "OrogenicRootBudgetMaximum",
    "MaximumOrogenicSurfaceReliefPerPass",
  ],
  "physical.river-incision": ["FluvialEquilibriumGradient"],
  "material.fluvial-transport": ["SedimentTransportFraction", "MaximumSedimentDepositionPerPass"],
  "physical.floodplains": ["FloodplainMaximumWidth"],
  "physical.coastal-construction": [
    "CoastalDetailStrength",
    "CoastalDetailScale",
    "CoastalDetailWarp",
    "CoastalDetailPassiveAmplitude",
    "CoastalDetailConvergentAmplitude",
    "CoastalDetailRiftedAmplitude",
    "CoastalDetailTransformAmplitude",
  ],
  "physical.coastal-evolution": ["CoastalDepositionFraction", "CoastalDepositionReach"],
  "physical.deltas": ["DeltaMaximumRadius"],
  "physical.volcanism": ["MantlePlumeCount"],
  "physical.impacts": ["ImpactPrimordialShare"],
} satisfies Record<string, (keyof typeof physicalProfile)[]>;

type ProfileCoefficient = (typeof owners)[keyof typeof owners][number];
export type PhysicalProfileOverrides = Partial<Record<ProfileCoefficient, number>>;
const coefficientSchemas: Partial<Record<ProfileCoefficient, z.ZodNumber>> = {
  CoastalDetailScale: z.number().finite().positive(),
  MantlePlumeCount: z.number().int().nonnegative(),
  ContinentalAssemblySeparationDepth: z.number().min(0).max(1),
  SedimentTransportFraction: z.number().min(0).max(1000),
  CoastalDepositionFraction: z.number().min(0).max(1000),
  ImpactPrimordialShare: z.number().min(0).max(1000),
};

export function physicalProfileConfiguration(id: string): Partial<GenerationFeature> {
  const keys = owners[id as keyof typeof owners];
  if (!keys) return {};
  const profile = z
    .object(
      Object.fromEntries(
        keys.map((key) => [
          key,
          (coefficientSchemas[key] ?? z.number().finite().nonnegative()).optional(),
        ])
      )
    )
    .strict()
    .transform((values) =>
      Object.fromEntries(
        Object.entries(values).filter((entry): entry is [string, number] => entry[1] !== undefined)
      )
    );
  return {
    configuration: z.object({ profile: profile.default({}) }).strict(),
    configurationFromLegacy: () => ({ profile: {} }),
  };
}

export function configuredPhysicalProfile(features: ResolvedFeatures): PhysicalProfileOverrides {
  const result: PhysicalProfileOverrides = {};
  for (const id of Object.keys(owners)) {
    const feature = features.selection[id];
    if (!feature?.enabled) continue;
    Object.assign(result, feature.configuration?.profile ?? {});
  }
  return result;
}
