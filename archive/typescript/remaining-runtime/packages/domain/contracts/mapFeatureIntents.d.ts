import type { ChangeSet, DomainSnapshot } from "./operations";
import { type IntentRegistry, type IntentContext } from "./intent";
import { type FeatureEdit } from "./featureIntents";
export declare function evaluateMapFeature(
  data: FeatureEdit,
  context: IntentContext,
  snapshot: DomainSnapshot
): ChangeSet;
export declare function registerMapFeatureIntents(registry: IntentRegistry): void;
