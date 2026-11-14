import type { Band } from "./lattice/band";
import type { Grid } from "./grids";
import type { Position } from "./model";
export interface MaterialCargoSamples {
  keys: readonly string[];
  /** Ordinary identities restored when actual natural movement ends custody. */
  releasedTo: readonly string[];
  slots: readonly string[];
  /** One start per cell plus the terminal offset; offsets count four-value records. */
  offsets: Band;
  /** Records are [slot, reservoir key (one-based), constituent host, charge per cubic metre]. */
  records: Band;
}
export declare function validMaterialShape(
  cargo: MaterialCargoSamples | undefined,
  count: number
): boolean;
/** The discrete donor used by categorical material samples, including chart seams and halo. */
export declare function fieldSampleIndex(grid: Grid, position: Position): number;
