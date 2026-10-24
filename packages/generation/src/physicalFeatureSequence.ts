import {
  featureContribution,
  type ResolvedFeatures,
  type FeatureContributionContext,
} from "./features";
import type { ProcessSequence } from "./process";
import { physicalInputContract } from "./physicalInputs";
import { atlasGenerationModules } from "./generationModules";
import { physicalFeatureDefinitions } from "./physicalFeatures";

/** Support identity is the profile slot, independent of requesting features. */
export function physicalFeatureSequence(
  slot: string,
  resolved: ResolvedFeatures,
  context?: FeatureContributionContext
): ProcessSequence {
  const registered = atlasGenerationModules.features();
  const definitions = registered.length ? registered : physicalFeatureDefinitions;
  return definitions
    .filter((feature) => resolved.selection[feature.id])
    .flatMap((feature) => featureContribution(feature, slot, resolved, context));
}

export function nativeFeatureContract(
  name: string,
  resolved: ResolvedFeatures,
  inheritedAbsences: string[] = []
) {
  return physicalInputContract(name, resolved, physicalFeatureDefinitions, inheritedAbsences);
}
