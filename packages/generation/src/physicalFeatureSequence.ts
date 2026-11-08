import {
  featureContribution,
  type ResolvedFeatures,
  type FeatureContributionContext,
} from "./features";
import type { ProcessSequence } from "./process";
import { atlasGenerationModules } from "./generationModules";
import { physicalFeatureDefinitions } from "./physicalFeatures";
import { nativeStepsOf } from "./physicalFeature";

/** Selected mountain operations run while contacts still exist, inside the plate move. */
export function plateDeformationSteps(
  resolved: ResolvedFeatures,
  context?: FeatureContributionContext
) {
  const operations = physicalFeatureSequence("epoch.mountains", resolved, context),
    steps = nativeStepsOf(physicalFeatureDefinitions);
  return operations.flatMap((operation) => {
    if (operation.kind !== "process") return [];
    const step = steps.find(([name]) => `atlas.${name}` === operation.process);
    return step ? [step] : [];
  });
}

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
