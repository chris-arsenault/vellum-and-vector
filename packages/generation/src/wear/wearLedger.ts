import type { PhysicalField } from "../canonry/field";
import { erode } from "../canonry/surface";

/** Takes a lowering off a cell's mean height and feeds what came off to the sediment. */
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
