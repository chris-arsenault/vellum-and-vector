import { type FeatureEdit } from "./featureIntents";
import { type IntentRegistry, type IntentContext } from "./intent";
import type { ReadRequirements, DomainSnapshot, ChangeSet } from "./operations";
export declare function mergeFeatureRequirements(
  edits: FeatureEdit[],
  context: IntentContext
): ReadRequirements;
export declare function evaluateFeatures(
  edits: FeatureEdit[],
  context: IntentContext,
  snapshot: DomainSnapshot
): ChangeSet;
export declare function registerCompoundFeatureIntents(registry: IntentRegistry): void;
