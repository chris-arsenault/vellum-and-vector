import type { Geometry } from "geojson";
import { type AdaptiveTopology } from "./adaptiveTopology";
import type { RegularGrid } from "./grids";
import type { ContourWorkspace } from "./contourWorkspace";
export { contourSupport, regularContourSupport } from "./contourSupport";
type Scalar = (x: number, y: number) => number;
export type LinearContourSample = [number, number, number];
/** Exact crossings of a piecewise linear sampled field need no root search. */
export declare function linearFieldContour(
  triangles: Iterable<LinearContourSample[]>,
  at: Scalar,
  level?: number,
  boundary?: Iterable<LinearContourSample[]>,
  workspace?: ContourWorkspace
): Geometry | null;
/** Shared face stations keep contours joined; refine curves inside conforming cell fans. */
export declare function fieldContour(
  source: AdaptiveTopology | RegularGrid,
  at: Scalar,
  selected?: Iterable<number>,
  level?: number,
  tolerance?: number,
  workspace?: ContourWorkspace
): Geometry | null;
