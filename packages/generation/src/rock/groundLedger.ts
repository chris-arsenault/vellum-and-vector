import type { PhysicalField } from "../canonry/field";
import { adjustCrustColumn } from "../canonry/crustTransport";
import { units } from "../canonry/math";
import { rebuild } from "../canonry/surface";
import { recordFlow, type FlowCause, type Pool } from "../coupling/flows";
import { stripRock } from "./rockColumn";

/**
 * The one writer of what comes off and lands on the ground: height, sediment, the rock column and
 * the sediment's books stay consistent because they change together here.
 */

const volumeOf = (map: PhysicalField, i: number, height: number) =>
  (height / 1024) * map.mesh.area(i);
/** Takes material off a cell, as a lowering of its mean height: loose cover first, then rock. */
export function erode(
  map: PhysicalField,
  i: number,
  requested: number,
  cause: FlowCause = "unnamed",
  to: Pool = "load"
): number {
  if (requested <= 0) return 0;
  const sediment = Math.min(requested, map.SedimentThickness.get(i));
  map.SedimentThickness.add(i, -sediment);
  recordFlow(map, cause, "loose", to, volumeOf(map, i, sediment));
  const bedrock = requested - sediment;
  map.BedrockElevation.add(i, -bedrock);
  if (bedrock > 0) {
    recordFlow(map, cause, "rock", to, volumeOf(map, i, bedrock));
    const belowRock = Math.max(0, bedrock - Math.max(0, map.SurfaceRockLoad.get(i)));
    map.SurfaceRockLoad.add(i, -bedrock);
    stripRock(map, i, Math.round(bedrock));
    if (belowRock > 0) thinCrust(map, i, belowRock);
  }
  rebuild(map, i);
  return requested;
}
/**
 * Wear that has cut through what was piled on the crust is cutting the crust itself, so an old belt's
 * root goes with it: rebound brings it up to be worn in turn until the ground is back to a plain.
 * Rock removed already rebounds as lost load, so this is the part of the rise that load does not give.
 */
function thinCrust(map: PhysicalField, i: number, amount: number) {
  const fraction = map.CrustContinentalFraction.get(i) / 1000,
    foundation = units(1000 + 3000 * fraction),
    spare = Math.max(0, map.CrustThickness.get(i) - foundation);
  if (spare > 0)
    adjustCrustColumn(map, i, map.CrustThickness.get(i) - Math.min(spare, amount * 0.7));
}
/** Lays loose material on a cell. */
export function deposit(
  map: PhysicalField,
  i: number,
  requested: number,
  cause: FlowCause = "unnamed",
  from: Pool = "load"
): number {
  const deposited = Math.max(0, requested);
  map.SedimentThickness.add(i, deposited);
  recordFlow(map, cause, from, "loose", volumeOf(map, i, deposited));
  map.CumulativeDeposition.add(i, deposited);
  map.SedimentDepositedTotal += (deposited / 1024) * map.mesh.area(i);
  rebuild(map, i);
  return deposited;
}
/** Takes a lowering off a cell and feeds what came off to the sediment on the move. */
export function wearAway(
  map: PhysicalField,
  i: number,
  lowering: number,
  cause: FlowCause = "unnamed"
) {
  const worn = erode(map, i, lowering, cause);
  map.SedimentSupply.add(i, worn);
  map.SedimentProducedTotal += (worn / 1024) * map.mesh.area(i);
  return worn;
}
/**
 * A channel cut to `depth` across `share` of the cell. A cell's height is the mean of its ground, so
 * that mean falls by the depth over that share only; the depth itself is remembered as incision.
 */
export function recordCut(
  map: PhysicalField,
  i: number,
  depth: number,
  share = 1,
  cause: FlowCause = "unnamed"
) {
  wearAway(map, i, Math.round(depth * share), cause);
  map.CumulativeFluvialErosion.add(i, depth);
}
/** Failed ground leaves a cell by volume, to rest on its neighbours. */
export function shed(map: PhysicalField, i: number, volume: number, cause: FlowCause = "slopes") {
  erode(map, i, (volume * 1024) / map.mesh.area(i), cause, "loose");
  map.SedimentProducedTotal += volume;
}
/** Failed ground comes to rest on a cell, by volume. */
export function settle(map: PhysicalField, i: number, volume: number) {
  map.SedimentThickness.add(i, (volume * 1024) / map.mesh.area(i));
  map.CumulativeDeposition.add(i, (volume * 1024) / map.mesh.area(i));
  map.SedimentDepositedTotal += volume;
  rebuild(map, i);
}
/** New rock stands on a cell, from wherever a builder drew it. Negative takes it away again. */
export function raiseRock(
  map: PhysicalField,
  i: number,
  amount: number,
  cause: FlowCause,
  from: Pool
) {
  map.BedrockElevation.add(i, amount);
  map.SurfaceRockLoad.add(i, amount);
  if (amount > 0) recordFlow(map, cause, from, "rock", volumeOf(map, i, amount));
  else recordFlow(map, cause, "rock", from, volumeOf(map, i, -amount));
}
/**
 * Rock turning to loose cover where it stands: the column loses it and the mantle gains it, and the
 * ground stays where it is. It is now what slopes, water and wind take first.
 */
export function weatherRock(map: PhysicalField, i: number, amount: number, cause: FlowCause) {
  map.BedrockElevation.add(i, -amount);
  map.SurfaceRockLoad.add(i, -amount);
  stripRock(map, i, Math.round(amount));
  map.SedimentThickness.add(i, amount);
  recordFlow(map, cause, "rock", "loose", volumeOf(map, i, amount));
  rebuild(map, i);
}
