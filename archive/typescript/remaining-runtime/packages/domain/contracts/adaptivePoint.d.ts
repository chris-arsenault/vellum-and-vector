import { type AdaptiveTopology } from "./adaptiveTopology";
import { type PreparedAdaptiveCell } from "./adaptiveHermite";
import { type AdaptiveSamples as Samples } from "./adaptiveFit";
/**
 * Shared vertex values and derivatives also constrain fine faces to their coarse patch. The
 * budget bounds each cache: a viewport reader keeps the default, a sweep over a whole lattice
 * (generation sampling every cell) passes room for every cell so nothing is prepared twice.
 */
export declare function prepareAdaptivePatches(
  t: AdaptiveTopology,
  values: Samples,
  budget?: number
): (i: number) => PreparedAdaptiveCell;
/** A prepared immutable evaluator computes only cells touched by a query or viewport. */
export declare function adaptivePointSampler(
  t: AdaptiveTopology,
  values: Samples,
  locate?: AdaptivePointLocator,
  patch?: (i: number) => PreparedAdaptiveCell
): (x: number, y: number) => number;
declare function locateAdaptivePoint(
  t: AdaptiveTopology,
  x: number,
  y: number
): {
  leaf: number;
  u: number;
  v: number;
};
export type AdaptivePointLocator = typeof locateAdaptivePoint;
/** Share only the current point's location across channels using the same topology. */
export declare function adaptivePointLocator(): AdaptivePointLocator;
export declare function sampleAdaptivePoint(
  t: AdaptiveTopology,
  values: Samples,
  x: number,
  y: number
): number;
export {};
