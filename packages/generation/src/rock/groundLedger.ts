import type { PhysicalField } from "../canonry/field";
import { rebuild } from "../canonry/surface";
import { stripRock } from "./rockColumn";

/**
 * The one writer of what comes off and lands on the ground: height, sediment, the rock column and
 * the sediment's books stay consistent because they change together here.
 */

/** Takes material off a cell, as a lowering of its mean height: loose cover first, then rock. */
export function erode(map: PhysicalField, i: number, requested: number): number {
  if (requested <= 0) return 0;
  const sediment = Math.min(requested, map.SedimentThickness.get(i));
  map.SedimentThickness.add(i, -sediment);
  const bedrock = requested - sediment;
  map.BedrockElevation.add(i, -bedrock);
  if (bedrock > 0) {
    map.SurfaceRockLoad.add(i, -bedrock);
    stripRock(map, i, Math.round(bedrock));
  }
  rebuild(map, i);
  return requested;
}
/** Lays loose material on a cell. */
export function deposit(map: PhysicalField, i: number, requested: number): number {
  const deposited = Math.max(0, requested);
  map.SedimentThickness.add(i, deposited);
  map.CumulativeDeposition.add(i, deposited);
  map.SedimentDepositedTotal += (deposited / 1024) * map.mesh.area(i);
  rebuild(map, i);
  return deposited;
}
/** Takes a lowering off a cell and feeds what came off to the sediment on the move. */
export function wearAway(map: PhysicalField, i: number, lowering: number) {
  const worn = erode(map, i, lowering);
  map.SedimentSupply.add(i, worn);
  map.SedimentProducedTotal += (worn / 1024) * map.mesh.area(i);
  return worn;
}
/**
 * A channel cut to `depth` across `share` of the cell. A cell's height is the mean of its ground, so
 * that mean falls by the depth over that share only; the depth itself is remembered as incision.
 */
export function recordCut(map: PhysicalField, i: number, depth: number, share = 1) {
  wearAway(map, i, Math.round(depth * share));
  map.CumulativeFluvialErosion.add(i, depth);
}
/** Failed ground leaves a cell by volume, to rest on its neighbours. */
export function shed(map: PhysicalField, i: number, volume: number) {
  erode(map, i, (volume * 1024) / map.mesh.area(i));
  map.SedimentProducedTotal += volume;
}
/** Failed ground comes to rest on a cell, by volume. */
export function settle(map: PhysicalField, i: number, volume: number) {
  deposit(map, i, (volume * 1024) / map.mesh.area(i));
}
