import { type AdaptiveTopology } from "./adaptiveTopology";
import type { Band } from "./lattice/band";
import { type PreparedAdaptiveCell } from "./adaptiveHermite";
export { evaluateAdaptiveCell } from "./adaptiveHermite";
export interface AdaptiveReconstruction {
  topology: AdaptiveTopology;
  values: Band;
  corners: Float64Array;
  patches: Float64Array;
  cells: PreparedAdaptiveCell[];
}
export declare function reconstructAdaptive(
  topology: AdaptiveTopology,
  values: Band
): AdaptiveReconstruction;
/** Shared Hermite faces match height and slope; an interior correction retains each sample. */
export declare function sampleAdaptive(
  surface: AdaptiveReconstruction,
  x: number,
  y: number
): number;
