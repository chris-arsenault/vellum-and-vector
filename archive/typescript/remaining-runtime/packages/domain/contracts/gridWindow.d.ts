import type { GridSurface } from "./grids";
import type { AdaptiveTopology } from "./adaptiveTopology";
import type { Bounds } from "./spatial";
/** Traverse only tree boxes touching a requested window; the stack is bounded by tree depth. */
export declare function adaptiveWindowLeaves(
  topology: AdaptiveTopology,
  bounds: Bounds
): Generator<number, void, unknown>;
/** Candidate sample centres for statistics and point predicates, without scanning the whole field. */
export declare function gridWindowCells(
  grid: GridSurface<string>,
  bounds: Bounds
): Generator<number, void, unknown>;
