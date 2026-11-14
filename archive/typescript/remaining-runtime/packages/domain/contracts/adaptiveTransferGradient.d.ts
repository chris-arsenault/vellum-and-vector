import { type AdaptiveTopology } from "./adaptiveTopology";
import type { Band } from "./lattice/band";
export type TransferSamples = Band | ((index: number) => number);
/** Face-weighted least squares with the same neighbor extrema limiter used by remeshing. */
export declare function transferGradients(
  topology: AdaptiveTopology,
  sample: (i: number) => number
): (i: number) => [number, number];
