import type { PhysicalField } from "../world/field";
import { cutShare, facetSurface } from "../rock/groundShares";

/** Present Ground supplies the bed; deposition can fill an old course and force it aside. */
export const currentBed = (map: PhysicalField, cell: number) =>
  cutShare(map, cell) > 0 ? facetSurface(map, cell, "cut") : map.Elevation.get(cell);

/** Water drains through the present valley floor, including channels still too small to name. */
export const drainageBed = (map: PhysicalField, cell: number) =>
  map.WaterKindCodes.get(cell) === 1 ? map.Elevation.get(cell) : currentBed(map, cell);
