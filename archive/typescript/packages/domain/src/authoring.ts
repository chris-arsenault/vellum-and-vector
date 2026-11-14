import { IntentRegistry } from "./intent";
import { registerBasicIntents } from "./authoringBasics";
import { registerAreaIntents } from "./areaIntents";
import { registerFeatureIntents } from "./featureIntents";
import { registerMapFeatureIntents } from "./mapFeatureIntents";
import { registerFieldIntents } from "./fieldIntents";
import { registerSettingsIntents } from "./settingsIntents";
import { registerProtectionIntents } from "./protectionIntents";
import { registerCompoundFeatureIntents } from "./compoundFeatures";
import { registerReconciliationIntents } from "./reconciliationIntents";
import { registerNodeMoveIntents } from "./nodeMove";
import { registerFieldReconciliation } from "./fieldReconciliation";

export function createIntentRegistry(): IntentRegistry {
  const registry = new IntentRegistry();
  registerBasicIntents(registry);
  registerAreaIntents(registry);
  registerFeatureIntents(registry);
  registerMapFeatureIntents(registry);
  registerFieldIntents(registry);
  registerSettingsIntents(registry);
  registerProtectionIntents(registry);
  registerCompoundFeatureIntents(registry);
  registerReconciliationIntents(registry);
  registerNodeMoveIntents(registry);
  registerFieldReconciliation(registry);
  return registry;
}
