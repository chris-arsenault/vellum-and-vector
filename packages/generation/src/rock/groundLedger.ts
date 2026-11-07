import type { PhysicalField } from "../world/field";
import { adjustCrustColumn } from "../world/crustTransport";
import { elevationLimit, rockLoadResponsePerMille, units } from "../world/math";
import { rebuild } from "../world/surface";
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
  cause: FlowCause,
  to: Pool = "load"
): number {
  if (requested <= 0) return 0;
  const sediment = Math.min(requested, map.SedimentThickness.get(i));
  map.SedimentThickness.add(i, -sediment);
  recordFlow(map, cause, "loose", to, volumeOf(map, i, sediment));
  if (requested > sediment) {
    const bedrock = requested - sediment;
    recordFlow(map, cause, "rock", to, volumeOf(map, i, bedrock));
    lowerRock(map, i, bedrock);
    stripRock(map, i, Math.round(bedrock));
  }
  rebuild(map, i);
  return requested;
}
/** Crust a cell holds above what its kind of crust stands on: what shortening has piled up. */
export function spareCrust(map: PhysicalField, i: number) {
  const fraction = map.CrustContinentalFraction.get(i) / 1000;
  return Math.max(0, map.CrustThickness.get(i) - units(1000 + 3000 * fraction));
}
/**
 * Rock comes off the top of a cell: first what was piled on the crust, then the crust's own column,
 * so an old belt's root goes with it. Lost load lets the ground rise back. Crust that goes lowers the
 * ground by its buoyancy alone, so load falls by what makes up the rest of the rise. Below the crust's
 * spare column nothing rises back: the cut stays a hole.
 */
function lowerRock(map: PhysicalField, i: number, amount: number) {
  const pile = Math.max(0, map.SurfaceRockLoad.get(i)),
    below = Math.max(0, amount - pile),
    crust = Math.min(spareCrust(map, i), below);
  map.BedrockElevation.add(i, -amount);
  map.SurfaceRockLoad.add(i, -(amount - below) - crust / (rockLoadResponsePerMille / 1000));
  if (crust > 0) adjustCrustColumn(map, i, map.CrustThickness.get(i) - crust);
}
/** The most this cell's surface can still rise before it reaches the height limit. */
export const headroom = (map: PhysicalField, i: number) =>
  Math.max(0, units(elevationLimit) - map.Elevation.get(i));
/**
 * Lays loose material on a cell, as far as the height limit lets it, and says how much it laid: what
 * does not fit stays with whoever was carrying it.
 */
export function deposit(
  map: PhysicalField,
  i: number,
  requested: number,
  cause: FlowCause,
  from: Pool = "load"
): number {
  const deposited = Math.min(Math.max(0, requested), headroom(map, i));
  map.SedimentThickness.add(i, deposited);
  recordFlow(map, cause, from, "loose", volumeOf(map, i, deposited));
  map.CumulativeDeposition.add(i, deposited);
  map.SedimentDepositedTotal += (deposited / 1024) * map.mesh.area(i);
  rebuild(map, i);
  return deposited;
}
/** Takes a lowering off a cell and feeds what came off to the sediment on the move. */
export function wearAway(map: PhysicalField, i: number, lowering: number, cause: FlowCause) {
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
  share: number,
  cause: FlowCause
) {
  wearAway(map, i, Math.round(depth * share), cause);
  map.CumulativeFluvialErosion.add(i, depth);
}
/** What is being carried leaves the map or goes out to sea, by volume. */
export function carryOut(map: PhysicalField, volume: number, cause: FlowCause) {
  map.SedimentExportedTotal += volume;
  recordFlow(map, cause, "load", "sea", volume);
}
/** Failed ground leaves a cell by volume, to rest on its neighbours. */
export function shed(map: PhysicalField, i: number, volume: number, cause: FlowCause) {
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
  if (amount > 0) {
    map.BedrockElevation.add(i, amount);
    map.SurfaceRockLoad.add(i, amount);
    recordFlow(map, cause, from, "rock", volumeOf(map, i, amount));
  } else if (amount < 0) {
    lowerRock(map, i, -amount);
    recordFlow(map, cause, "rock", from, volumeOf(map, i, -amount));
  }
}
/**
 * A cell's crust stands up as rock on it, as far as it has crust piled up to give and the height limit
 * leaves room, and says how much stood: nothing stands that was not there to move.
 */
export function raiseFromCrust(map: PhysicalField, i: number, wanted: number, cause: FlowCause) {
  const amount = Math.min(wanted, spareCrust(map, i), headroom(map, i));
  if (amount <= 0) return 0;
  adjustCrustColumn(map, i, map.CrustThickness.get(i) - amount);
  raiseRock(map, i, amount, cause, "crust");
  return amount;
}
/**
 * The ground moves with no rock made or lost: it sags as what is under it goes, or lifts as something
 * rises beneath it. What it stands on takes the difference.
 */
export function displaceGround(map: PhysicalField, i: number, amount: number, cause: FlowCause) {
  map.BedrockElevation.add(i, amount);
  recordFlow(map, cause, "crust", "crust", volumeOf(map, i, Math.abs(amount)));
  rebuild(map, i);
}
/**
 * Rock turning to loose cover where it stands: the column loses it and the mantle gains it, and the
 * ground stays where it is. It is now what slopes, water and wind take first.
 */
export function weatherRock(map: PhysicalField, i: number, amount: number, cause: FlowCause) {
  map.BedrockElevation.add(i, -amount);
  map.SurfaceRockLoad.add(i, -Math.min(amount, Math.max(0, map.SurfaceRockLoad.get(i))));
  stripRock(map, i, Math.round(amount));
  map.SedimentThickness.add(i, amount);
  recordFlow(map, cause, "rock", "loose", volumeOf(map, i, amount));
  rebuild(map, i);
}
