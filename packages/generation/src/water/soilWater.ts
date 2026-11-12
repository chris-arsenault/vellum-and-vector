import { MapScale } from "@atlas/domain";
import { respond } from "../coupling/answers";
import type { PhysicalField } from "../world/field";
import { putSoilWater } from "./column";

/**
 * The soil's water: one store, filled and drawn down by the year's water budget and read by
 * whatever grows or lives on it. What else wets a soil (a ditch, a spring) says so by
 * answering the budget's questions; nothing else writes the store.
 */
respond({ key: "soilWetting", by: "soil water", reads: [], base: () => 0 });
respond({ key: "soilWaterHeld", by: "soil water", reads: [], base: () => 0 });

/** The water a cell's soil holds when full, as a depth: deeper and richer soil holds more. */
export const soilWaterCapacity = (map: PhysicalField, i: number) =>
  map.SoilDepth.get(i) * (0.12 + Math.min(1, map.SoilCarbon.get(i) / 30) * 0.15);
/** How full a cell's soil is, 0 to 1. */
export function soilWaterFilled(map: PhysicalField, i: number) {
  const capacity = soilWaterCapacity(map, i);
  return capacity > 0 ? Math.min(1, map.SoilWater.get(i) / capacity) : 0;
}
/**
 * States what a cell's soil holds through the year: the budget's mean in millimetres, with
 * what was put in from outside, never less than what it is kept holding.
 */
export function holdSoilWater(
  map: PhysicalField,
  i: number,
  millimetres: number,
  wetting: number,
  held: number
) {
  putSoilWater(map, i, Math.max(held, MapScale.metres(millimetres, "mm") + wetting));
}
/** Soil that is stripped away takes its share of the water it held. */
export function loseSoilWater(map: PhysicalField, i: number, share: number) {
  putSoilWater(map, i, map.SoilWater.get(i) * (1 - Math.max(0, Math.min(1, share))));
}
