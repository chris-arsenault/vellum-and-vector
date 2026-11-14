import type { AdaptiveTopology } from "./adaptiveTopology";
import type { GridSurface } from "./grids";
import { Band } from "./lattice/band";
import type { BlockArray } from "./lattice/blockScratch";
import { BlockCache } from "./lattice/blockCache";
type Detached<T> = {
  [K in keyof T]: T[K] extends Band
    ? BlockArray
    : T[K] extends Partial<Record<string, Band>>
      ? Partial<Record<keyof T[K], BlockArray>>
      : T[K];
};
export type TopologyArrays = Omit<Detached<AdaptiveTopology>, "coverage">;
/**
 * A grid as plain typed arrays, for a worker message. Bands belong to one worker's block
 * cache and never cross a port; a small grid (a preview) crosses as arrays and is attached
 * to the receiver's cache.
 */
export type GridArrays = Omit<Detached<GridSurface>, "coverage" | "topology" | "overlays"> & {
  topology?: TopologyArrays;
  overlays?: {
    grid: GridArrays;
    channels: string[];
    mapOnly?: boolean;
  }[];
};
/** Copy every band of the grid into plain arrays. */
export declare function detachGrid(grid: GridSurface): GridArrays;
/** Bands over the arrays (no copy) in a coverage of the receiver's cache. */
export declare function attachGrid(arrays: GridArrays, cache?: BlockCache): GridSurface;
export {};
