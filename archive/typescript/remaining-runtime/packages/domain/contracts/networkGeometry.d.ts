import type { Geometry } from "geojson";
import type { Position } from "./model";
export declare function lineEndpoints(geometry: Geometry): Position[];
export declare function splitDirectedLine(
  geometry: Geometry,
  anchors: Position[],
  precision: number
): Geometry[];
