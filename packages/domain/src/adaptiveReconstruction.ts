import {
  adaptiveCell,
  adaptiveGeometry,
  adaptiveLeafAt,
  type AdaptiveTopology,
} from "./adaptiveTopology";
import { prepareAdaptivePatches } from "./adaptivePoint";
import { evaluatePreparedAdaptiveCell, type PreparedAdaptiveCell } from "./adaptiveHermite";
export { evaluateAdaptiveCell } from "./adaptiveHermite";

export interface AdaptiveReconstruction {
  topology: AdaptiveTopology;
  values: ArrayLike<number>;
  corners: Float64Array;
  patches: Float64Array;
  cells: PreparedAdaptiveCell[];
}

/** Weighted least-squares gradients use all physical neighbors, including split faces. */
export function adaptiveGradients(
  topology: AdaptiveTopology,
  values: ArrayLike<number>,
  geometry = adaptiveGeometry(topology),
  selected?: ArrayLike<number>
) {
  const x = new Float64Array(values.length),
    y = new Float64Array(values.length);
  for (let cell = 0; cell < (selected?.length ?? values.length); cell++) {
    const i = selected ? selected[cell] : cell;
    let xx = 0,
      xy = 0,
      yy = 0,
      vx = 0,
      vy = 0;
    for (let at = topology.offsets[i]; at < topology.offsets[i + 1]; at++) {
      const j = topology.neighbors[at];
      const dx = geometry.x[j] - geometry.x[i],
        dy = geometry.y[j] - geometry.y[i];
      const weight = topology.faceLengths[at] / topology.distances[at] ** 2;
      const delta = values[j] - values[i];
      xx += weight * dx * dx;
      xy += weight * dx * dy;
      yy += weight * dy * dy;
      vx += weight * dx * delta;
      vy += weight * dy * delta;
    }
    const determinant = xx * yy - xy * xy;
    if (determinant > 0) {
      x[i] = (vx * yy - vy * xy) / determinant;
      y[i] = (vy * xx - vx * xy) / determinant;
    }
  }
  return { x, y };
}
export function reconstructAdaptive(
  topology: AdaptiveTopology,
  values: ArrayLike<number>
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
/** Shared Hermite faces match height and slope without cell-local sample corrections. */
export function sampleAdaptive(surface: AdaptiveReconstruction, x: number, y: number): number {
  const i = adaptiveLeafAt(surface.topology, x, y);
  if (i < 0) return NaN;
  const [x0, y0, x1, y1] = adaptiveCell(surface.topology, i);
  return evaluatePreparedAdaptiveCell(surface.cells[i], (x - x0) / (x1 - x0), (y - y0) / (y1 - y0));
}
