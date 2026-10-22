// Generated metadata comes directly from Canonry's layer contracts; regenerate with make canonry-fixtures.
import generated from "./contracts.generated.json" with { type: "json" };
import type { NativeStep } from "./sequence";
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { validateNativeLayer } from "./layerValidation";
import { nativeFactsManaged } from "../productLedger";
import { preparePhysicalChannels } from "./continuousState";
import { physicalWrites } from "./physicalWrites";

export interface NativeContract {
  salt: number;
  requires: string[];
  produces: string[];
  invalidates: string[];
}
export const nativeContracts: Record<string, NativeContract> = generated;
function checkNativeInputs(map: PhysicalField, contract: NativeContract, name: string) {
  for (const fact of contract.requires)
    if (!map.AvailableFacts.has(fact)) throw new Error(`${name} requires fresh ${fact}.`);
}
export function applyNativeStep(
  map: PhysicalField,
  context: PhysicalContext,
  step: NativeStep,
  effective?: NativeContract
) {
  const [name, salt, process] = step,
    contract = effective ?? nativeContracts[name];
  if (!contract || contract.salt !== salt)
    throw new Error(`Unknown Canonry process or salt: ${name}.`);
  if (!physicalWrites[name]) throw new Error(`Declare physical field writes for ${name}.`);
  const managed = nativeFactsManaged(map.AvailableFacts);
  if (!managed) checkNativeInputs(map, contract, name);
  try {
    process(map, context);
    preparePhysicalChannels(map, physicalWrites[name]);
    validateNativeLayer(map, context, name, contract.produces);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`${name} failed in epoch ${context.EpochIndex + 1}: ${detail}`, { cause });
  }
  if (!managed) {
    for (const fact of contract.invalidates) map.AvailableFacts.delete(fact);
    for (const fact of contract.produces) map.AvailableFacts.add(fact);
  }
}
