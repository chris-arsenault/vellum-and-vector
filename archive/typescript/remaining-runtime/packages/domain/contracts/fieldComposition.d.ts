import type { Grid, GridSurface } from "./grids";
export declare function overlayField(
  base: GridSurface<string>,
  patch: Grid<string>,
  channels?: string[],
  mapOnly?: boolean
): void;
/** Keep authored patches at their own resolution; consumers use the shared evaluator. */
export declare function materializeField<Name extends string>(
  source: GridSurface<Name>
): GridSurface<Name>;
