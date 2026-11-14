import { type AdaptiveTopology } from "./adaptiveTopology";
import type { Band } from "./lattice/band";
export type AdaptiveSamples = Band | ((index: number) => number);
export declare const adaptiveSample: (values: AdaptiveSamples, i: number) => number;
/**
 * Local curvature is needed to reconstruct smooth terrain without cell-centre humps. The
 * budget bounds the fit cache: a viewport reader keeps the default, a sweep over a whole
 * lattice passes room for every cell.
 */
export declare function adaptiveFits(
  t: AdaptiveTopology,
  values: AdaptiveSamples,
  budget?: number
): (i: number) => number[];
