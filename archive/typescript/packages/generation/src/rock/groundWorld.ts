import type { PhysicalField } from "../world/field";
import { groundStorage } from "./groundStorage";

/** The forming crust receives its continental affinity before transport owns its column. */
export function initializeContinentalAffinity(map: PhysicalField, cell: number, affinity: number) {
  groundStorage(map).CrustContinentalFraction.set(cell, affinity);
}
/** Shortening supplies root material that a later construction operation can draw upon. */
export function accrueRootReserve(map: PhysicalField, cell: number, amount: number) {
  const reserve = groundStorage(map).CrustRootReserve;
  reserve.set(cell, Math.max(0, reserve.get(cell) + amount));
}
/** A construction operation consumes available root material; unspent material remains attached. */
export function spendRootReserve(map: PhysicalField, cell: number, amount: number) {
  const reserve = groundStorage(map).CrustRootReserve,
    spent = Math.min(reserve.get(cell), Math.max(0, amount));
  reserve.add(cell, -spent);
  return spent;
}
/** A distributed belt operation leaves this fraction of each contributing reserve in place. */
export function retainRootReserve(map: PhysicalField, cell: number, fraction: number) {
  const reserve = groundStorage(map).CrustRootReserve;
  reserve.set(cell, reserve.get(cell) * Math.max(0, Math.min(1, fraction)));
}
/** Province contacts become inherited properties of the ground that carries them. */
export function markGroundSeam(map: PhysicalField, cell: number) {
  groundStorage(map).CrustProvinceSeam.set(cell, 1);
}
/** Identity and retained strength describe the same collision seam and are committed together. */
export function recordGroundSuture(
  map: PhysicalField,
  cell: number,
  pair: number,
  strength: number
) {
  const ground = groundStorage(map);
  ground.CrustSuturePairIds.set(cell, pair);
  ground.CrustSutureStrength.set(cell, strength);
}
