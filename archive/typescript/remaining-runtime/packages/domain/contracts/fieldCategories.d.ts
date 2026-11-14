import type { Geometry } from "geojson";
import { type GridSurface } from "./grids";
/** Categories in the composed field; later patches replace the covered base. */
export declare function fieldCategories(
  grid: GridSurface<string>,
  channel: string,
  footprint?: Geometry
): number[];
