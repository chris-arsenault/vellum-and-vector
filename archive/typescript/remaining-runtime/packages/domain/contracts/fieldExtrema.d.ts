import type { Geometry } from "geojson";
import type { GridSurface } from "./grids";
export declare function fieldExtrema(
  grid: GridSurface<string>,
  channel: string,
  footprint: Geometry
): [number, number] | null;
