import type { Grid } from "./grids";
import type { Area, Layer } from "./model";
import type { DomainSnapshot } from "./operations";
import { type MaterializedCoverage } from "./coverage";
export declare function authoredFieldCoverage(
  snapshot: DomainSnapshot,
  area: Area,
  layer: Layer,
  field: string,
  grid: Grid
): MaterializedCoverage;
