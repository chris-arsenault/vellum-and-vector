import type { Bounds } from "./spatial";
import { type AdaptiveTopology } from "./adaptiveTopology";
import type { Band } from "./lattice/band";
import type { Coverage } from "./lattice/coverage";
import { type TransferSamples } from "./adaptiveTransferGradient";
type Quantity = "intensive" | "extensive" | "category";
export declare function visitAdaptiveOverlap(
  topology: AdaptiveTopology,
  bounds: Bounds,
  visit: (leaf: number) => void
): void;
/** Stream overlapping leaves with a traversal stack proportional to tree depth. */
export declare function overlappingAdaptiveLeaves(
  topology: AdaptiveTopology,
  bounds: Bounds,
  ascending?: boolean
): Generator<number, void, unknown>;
/**
 * Integrate local overlaps without retaining a world-sized overlap or gradient table.
 * Results are run-lifetime bands, one sample per target leaf, in `coverage`.
 */
export declare function prepareAdaptiveTransfer(
  source: AdaptiveTopology,
  target: AdaptiveTopology,
  coverage?: Coverage
): (values: TransferSamples, quantity: Quantity) => Band;
export declare function transferAdaptive(
  source: AdaptiveTopology,
  target: AdaptiveTopology,
  values: Band,
  quantity: Quantity,
  coverage?: Coverage
): Band;
export {};
