import type { Geometry } from "geojson";
import type { Position } from "./model";
/** Roughly spaced geographic centres, clipped to the shore; no equal-area solve. */
export declare function regionalDistricts(
  shape: Geometry,
  targetArea: number,
  anchors?: Position[],
  precision?: number
): Geometry[];
