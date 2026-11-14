import type { DomainSnapshot } from "./operations";
import type { GridSurface } from "./grids";
/** Numerical resources are immutable inputs. Copy mutable records, share their typed data. */
export declare function cloneSnapshot(source: DomainSnapshot): DomainSnapshot;
/** Copy input metadata without expanding immutable committed bands into resident samples. */
export declare function cloneFieldInput(grid: GridSurface): GridSurface;
