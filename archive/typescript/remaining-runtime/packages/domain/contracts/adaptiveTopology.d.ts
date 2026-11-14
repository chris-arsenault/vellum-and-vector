import type { Bounds } from "./spatial";
import type { Band } from "./lattice/band";
import type { BlockCache } from "./lattice/blockCache";
import type { Coverage } from "./lattice/coverage";
/**
 * Quadtree and reciprocal control-volume interfaces. Every array is a band in the topology's
 * coverage (one cell per leaf), so a large hierarchy pages like any other world state.
 * Node arrays (`boxes`, `children`, `levels`, `leafIndex`) and face arrays (`neighbors` and
 * the face metrics, indexed through `offsets`) have their own lengths.
 */
export interface AdaptiveTopology {
  bounds: Bounds;
  coverage: Coverage;
  boxes: Band;
  children: Band;
  levels: Band;
  leaves: Band;
  leafIndex: Band;
  offsets: Band;
  neighbors: Band;
  faceLengths: Band;
  distances: Band;
  directionX: Band;
  directionY: Band;
  normalX: Band;
  normalY: Band;
}
export interface AdaptiveSampling {
  maximumSize: number;
  minimumSize: number;
  refine?: (bounds: Bounds, level: number) => boolean;
}
/** Leaves of the topology. */
export declare function adaptiveLeafCount(topology: AdaptiveTopology): number;
export declare function createAdaptiveTopology(
  bounds: Bounds,
  sampling: AdaptiveSampling,
  cache?: BlockCache
): AdaptiveTopology;
export declare function refineAdaptiveTopology(
  source: AdaptiveTopology,
  selected: Iterable<number>,
  minimumSize: number
): AdaptiveTopology;
/** Refine requested support and grade its interfaces before building final adjacency. */
export declare function refineAdaptiveWhere(
  source: AdaptiveTopology,
  minimumSize: number,
  refine: (box: Bounds) => boolean
): AdaptiveTopology;
export declare function adaptiveCell(topology: AdaptiveTopology, leaf: number): Bounds;
export declare function adaptiveLeafAt(topology: AdaptiveTopology, x: number, y: number): number;
/** Per-leaf geometry bands in the topology's coverage. */
export declare function adaptiveGeometry(topology: AdaptiveTopology): {
  x: Band;
  y: Band;
  width: Band;
  height: Band;
  areas: Band;
  boundary: Band;
};
