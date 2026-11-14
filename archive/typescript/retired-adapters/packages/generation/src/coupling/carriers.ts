import type { PhysicalField } from "../world/field";
import type { TransportPlan } from "../world/transportPlan";

/**
 * Owners whose state rides the crust as a package say how. Plate transport runs every carrier
 * after it has moved what it moves itself, and learns nothing about what they carry.
 */
export type Carrier = (map: PhysicalField, plan: TransportPlan) => void;
const carriers = new Map<string, Carrier>();

/** An owner joins the crust's carriers under its own name. */
export function carriedBy(owner: string, carrier: Carrier) {
  if (carriers.has(owner)) throw new Error(`${owner} already carries its state.`);
  carriers.set(owner, carrier);
}
export function carryOwned(map: PhysicalField, plan: TransportPlan) {
  for (const carrier of carriers.values()) carrier(map, plan);
}
