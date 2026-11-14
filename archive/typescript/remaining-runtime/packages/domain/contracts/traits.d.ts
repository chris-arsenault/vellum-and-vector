import type { Area, Trait } from "./model";
import type { Grid } from "./grids";
export declare function specializeTraits(
  inherited: Trait[],
  local: Trait[],
  footprint: Area["footprint"]
): Trait[];
export declare function effectiveTraits(
  areas: Record<string, Area>,
  id: string,
  path?: string[]
): Trait[];
export declare function validateBoundaryTraits(area: Area): void;
export declare function validateFieldTraits(
  area: Area,
  grid: Grid<string>,
  channel: string,
  fact?: string
): void;
