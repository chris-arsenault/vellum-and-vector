import { type Grid, type GridSurface } from "./grids";
/** Patch-cache room for a sweep over every cell of an adaptive grid (prepared records per cell). */
export declare function sweepBudget(grid: GridSurface<string>): number | undefined;
export declare function resample(
  source: GridSurface<string>,
  target: Grid<string>,
  channel: string,
  discrete?: boolean
): void;
/** Compose each channel at the target's own physical samples, retaining patch precedence. */
export declare function resampleChannels(
  source: GridSurface<string>,
  target: Grid<string>,
  channels?: string[]
): void;
