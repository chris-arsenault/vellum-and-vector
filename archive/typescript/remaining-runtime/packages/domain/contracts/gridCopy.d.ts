import type { GridSurface } from "./grids";
/** Copy a grid's samples copy-on-write: no band is read whole, blocks diverge on write. */
export declare function copyGrid<T extends GridSurface<string>>(source: T): T;
