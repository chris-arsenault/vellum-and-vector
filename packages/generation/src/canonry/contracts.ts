// Generated metadata comes directly from Canonry's layer contracts; regenerate with make canonry-fixtures.
import generated from "./contracts.generated.json";
import type { NativeStep } from "./sequence";
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { validateNativeLayer } from "./layerValidation";

export interface NativeContract {
  salt: number;
  requires: string[];
  produces: string[];
  invalidates: string[];
}
export const nativeContracts: Record<string, NativeContract> = generated;
export function applyNativeStep(map: PhysicalField, context: PhysicalContext, step: NativeStep) {
  const [name, salt, process] = step,
    contract = nativeContracts[name];
  if (!contract || contract.salt !== salt)
    throw new Error(`Unknown Canonry process or salt: ${name}.`);
  for (const fact of contract.requires)
    if (!map.AvailableFacts.has(fact)) throw new Error(`${name} requires fresh ${fact}.`);
  process(map, context);
  validateNativeLayer(map, context, name, contract.produces);
  for (const fact of contract.invalidates) map.AvailableFacts.delete(fact);
  for (const fact of contract.produces) map.AvailableFacts.add(fact);
}
