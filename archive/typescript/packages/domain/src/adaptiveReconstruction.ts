import { adaptiveCell, adaptiveLeafAt, type AdaptiveTopology } from "./adaptiveTopology";
import { prepareAdaptivePatches } from "./adaptivePoint";
import type { Band } from "./lattice/band";
import { evaluatePreparedAdaptiveCell, type PreparedAdaptiveCell } from "./adaptiveHermite";
export { evaluateAdaptiveCell } from "./adaptiveHermite";

export interface AdaptiveReconstruction {
  topology: AdaptiveTopology;
  values: Band;
  corners: Float64Array;
  patches: Float64Array;
  cells: PreparedAdaptiveCell[];
}

export function reconstructAdaptive(
  topology: AdaptiveTopology,
  values: Band
): AdaptiveReconstruction {
  const at = prepareAdaptivePatches(topology, values);
  const patches = new Float64Array(values.length * 16),
    corners = new Float64Array(values.length * 4),
    cells: PreparedAdaptiveCell[] = [];
  for (let i = 0; i < values.length; i++) {
    const cell = at(i),
      patch = cell.coefficients;
    cells.push(cell);
    patches.set(patch, i * 16);
    for (let c = 0; c < 4; c++) corners[i * 4 + c] = patch[c * 4];
  }
  return { topology, values, corners, patches, cells };
}
/** Shared Hermite faces match height and slope; an interior correction retains each sample. */
export function sampleAdaptive(surface: AdaptiveReconstruction, x: number, y: number): number {
  const i = adaptiveLeafAt(surface.topology, x, y);
  if (i < 0) return NaN;
  const [x0, y0, x1, y1] = adaptiveCell(surface.topology, i);
  return evaluatePreparedAdaptiveCell(surface.cells[i], (x - x0) / (x1 - x0), (y - y0) / (y1 - y0));
}
