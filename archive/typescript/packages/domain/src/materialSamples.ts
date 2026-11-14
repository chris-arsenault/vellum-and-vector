import type { Band } from "./lattice/band";
import type { Grid } from "./grids";
import type { Position } from "./model";
import { fieldPosition } from "./gridPeriodicity";
import { adaptiveLeafAt } from "./adaptiveTopology";

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
export function validMaterialShape(cargo: MaterialCargoSamples | undefined, count: number) {
  return (
    !cargo ||
    (cargo.offsets.length === count + 1 &&
      cargo.records.length % 4 === 0 &&
      cargo.releasedTo.length === cargo.keys.length)
  );
}
/** The discrete donor used by categorical material samples, including chart seams and halo. */
export function fieldSampleIndex(grid: Grid, position: Position): number {
  const p = fieldPosition(grid, position),
    [west, south, east, north] = grid.bounds,
    x = Math.max(west, Math.min(east, p.x)),
    y = Math.max(south, Math.min(north, p.y));
  if (grid.topology) return adaptiveLeafAt(grid.topology, x, y);
  return (
    Math.round(((y - south) / (north - south)) * (grid.height - 1)) * grid.width +
    Math.round(((x - west) / (east - west)) * (grid.width - 1))
  );
}
