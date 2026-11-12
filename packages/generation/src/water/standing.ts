import type { PhysicalField } from "../world/field";
import { noWaterSurface } from "../world/math";

/**
 * Standing water on a cell: sea or lake, with its depth and the height of its surface. These
 * are the only ways a cell comes to hold standing water or to lose it, whoever asks.
 */
export function clearWaterSurface(map: PhysicalField, i: number) {
  map.WaterDepths.set(i, 0);
  map.WaterSurfaceElevations.set(i, noWaterSurface);
}
export function setWaterSurface(map: PhysicalField, i: number, surface: number) {
  const depth = surface - map.Elevation.get(i);
  if (depth <= 0) throw new Error("Water surface must be above its physical floor.");
  map.WaterSurfaceElevations.set(i, surface);
  map.WaterDepths.set(i, depth);
}
/** The ground under standing water moved: the water is as deep as its surface now stands above it. */
export function reconcileWater(map: PhysicalField, i: number) {
  const surface = map.WaterSurfaceElevations.get(i);
  if (surface === noWaterSurface) return;
  if (surface > map.Elevation.get(i)) {
    map.WaterDepths.set(i, surface - map.Elevation.get(i));
    return;
  }
  map.WaterKindCodes.set(i, 0);
  map.WaterBodyIds.set(i, 0);
  map.LakeOutletTargets.set(i, -1);
  map.LakeOverflow.set(i, 0);
  clearWaterSurface(map, i);
}
/** A cell behind a barrier holds water to the barrier's crest, as part of one body; no river runs under it. */
export function impound(map: PhysicalField, i: number, body: number, crest: number) {
  map.WaterKindCodes.set(i, 2);
  map.WaterBodyIds.set(i, body);
  setWaterSurface(map, i, crest);
  map.RiverOrders.set(i, 0);
}
/**
 * A work that holds water up on its cell (a mill pond, a weir, a flooded threshold) keeps the
 * surface there at least so high. It makes no lake and moves no water.
 */
export function holdWaterSurface(map: PhysicalField, i: number, surface: number) {
  if (surface > map.WaterSurfaceElevations.get(i)) map.WaterSurfaceElevations.set(i, surface);
}
/** A lake bed that has given up what its water left behind remembers no lake. */
export function forgetLake(map: PhysicalField, i: number) {
  map.LakeMemory.set(i, 0);
}
