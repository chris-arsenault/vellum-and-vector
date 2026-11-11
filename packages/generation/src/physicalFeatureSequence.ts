import {
  featureContribution,
  type ResolvedFeatures,
  type FeatureContributionContext,
} from "./features";
import type { ProcessInvocation, ProcessSequence } from "./process";
import { physicalSteps } from "./world/physicalSteps";
import { atlasGenerationModules } from "./generationModules";
import { physicalFeatureDefinitions } from "./physicalFeatures";
import { nativeStepsOf } from "./physicalFeature";
import { selectOperation } from "./processOperation";
import type { PhysicalField } from "./world/field";
import { physicalSeeds } from "./world/context";

const featureOwners = () => {
  const registered = atlasGenerationModules.features();
  return registered.length ? registered : physicalFeatureDefinitions;
};

/** Selection installs the executable queries already owned by the feature's native operations. */
export function bindFeatureQueries(map: PhysicalField, resolved: ResolvedFeatures, seed: number) {
  const selected = featureOwners().filter((feature) => resolved.selection[feature.id]?.enabled);
  for (const step of nativeStepsOf(selected))
    for (const process of step[3])
      if (process.execution === "field" && process.operation.kind === "query")
        selectOperation(map, process.operation, (input) => ({
          ...input,
          context: {
            ...input.context,
            ...physicalSeeds(seed, step[1], input.context.EpochIndex),
          },
        }));
}

/** Construction, immediate failure and load response settle before the next plate move. */
export function plateDeformationSteps(
  resolved: ResolvedFeatures,
  context?: FeatureContributionContext
) {
  const operations = [
      "epoch.mountains",
      "material.hillslopes",
      "material.support.before-margins",
    ].flatMap((slot) => physicalFeatureSequence(slot, resolved, context)),
    steps = nativeStepsOf(featureOwners());
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
  return featureOwners()
    .filter((feature) => resolved.selection[feature.id])
    .flatMap((feature) => featureContribution(feature, slot, resolved, context));
}

/** Both execution policies use feature selection, native hooks and the same process invocations. */
export function composeFeatureSlot(
  slot: string,
  occurrence: string,
  context: FeatureContributionContext,
  parameters: ProcessInvocation["parameters"] = {}
): ProcessSequence {
  const body = physicalFeatureSequence(slot, context.resolved, context).flatMap((step) => {
    if (step.kind !== "process") return [step];
    const native = Object.hasOwn(physicalSteps, step.process.slice("atlas.".length));
    const hooks = { ...context, process: step.process };
    return [
      ...atlasGenerationModules.contribute("before.model-pass", context.resolved, hooks),
      native ? { ...step, parameters: { ...parameters, ...step.parameters } } : step,
      ...atlasGenerationModules.contribute("after.model-pass", context.resolved, hooks),
    ];
  });
  return body.map((step) => ({ ...step, id: `${occurrence}/${step.id}` }));
}
