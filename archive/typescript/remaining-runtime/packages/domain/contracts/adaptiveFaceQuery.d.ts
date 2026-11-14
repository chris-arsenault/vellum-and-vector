import type { AdaptiveTopology } from "./adaptiveTopology";
export type AdaptiveFaceTree = Pick<
  AdaptiveTopology,
  "leaves" | "boxes" | "children" | "leafIndex"
>;
/** Traverse the exact adjoining face; no world-wide side maps or floating-point probes. */
export declare function visitAdaptiveFace(
  tree: AdaptiveFaceTree,
  leaf: number,
  axis: 0 | 1,
  side: -1 | 1,
  visit: (target: number, length: number, nx: number, ny: number) => void,
  lineOffset?: number
): void;
export declare function visitAdaptiveNeighbors(
  tree: AdaptiveFaceTree,
  leaf: number,
  visit: (target: number, length: number, nx: number, ny: number) => void
): void;
