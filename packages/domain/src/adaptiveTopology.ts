import type { Bounds } from "./spatial";
import { requireThat } from "./errors";
import { adaptiveFaces } from "./adaptiveFaces";
import type { NumericalVector, NumericalAllocator } from "./numericalVector";
import { allocateNumerical } from "./numericalAllocation";
import { buildAdaptiveTree } from "./adaptiveTreeBuild";
import { balanceAdaptiveTree } from "./adaptiveTreeBalance";
import { refineSelectedTree, refineWhereTree } from "./adaptiveTreeRefine";

/** Quadtree and reciprocal control-volume interfaces, independent of numerical storage. */
export interface AdaptiveTopology {
  bounds: Bounds;
  boxes: NumericalVector;
  children: NumericalVector;
  levels: NumericalVector;
  leaves: NumericalVector;
  leafIndex: NumericalVector;
  offsets: NumericalVector;
  neighbors: NumericalVector;
  faceLengths: NumericalVector;
  distances: NumericalVector;
  directionX: NumericalVector;
  directionY: NumericalVector;
  normalX: NumericalVector;
  normalY: NumericalVector;
}
export interface AdaptiveSampling {
  maximumSize: number;
  minimumSize: number;
  refine?: (bounds: Bounds, level: number) => boolean;
}
export function createAdaptiveTopology(
  bounds: Bounds,
  sampling: AdaptiveSampling,
  numerical?: NumericalAllocator
): AdaptiveTopology {
  requireThat(
    bounds.every(Number.isFinite) && bounds[2] > bounds[0] && bounds[3] > bounds[1],
    "adaptive_extent",
    "Adaptive fields require a finite positive extent."
  );
  requireThat(
    Number.isFinite(sampling.maximumSize) &&
      sampling.minimumSize > 0 &&
      sampling.minimumSize <= sampling.maximumSize,
    "adaptive_resolution",
    "Adaptive sampling requires positive physical resolutions."
  );
  const tree = buildAdaptiveTree(
    bounds,
    (box, level) => {
      const size = Math.max(box[2] - box[0], box[3] - box[1]);
      return (
        size > sampling.maximumSize ||
        (size > sampling.minimumSize && !!sampling.refine?.(box, level))
      );
    },
    numerical
  );
  const balanced = balanceAdaptiveTree(tree, numerical);
  return { ...balanced, ...adaptiveFaces(balanced, numerical) };
}
function validateMinimum(minimumSize: number) {
  requireThat(
    Number.isFinite(minimumSize) && minimumSize > 0,
    "adaptive_resolution",
    "Refinement requires a positive physical minimum size."
  );
}
export function refineAdaptiveTopology(
  source: AdaptiveTopology,
  selected: Iterable<number>,
  minimumSize: number,
  numerical?: NumericalAllocator
): AdaptiveTopology {
  validateMinimum(minimumSize);
  return refineSelectedTree(source, selected, minimumSize, numerical);
}
/** Refine requested support and grade its interfaces before building final adjacency. */
export function refineAdaptiveWhere(
  source: AdaptiveTopology,
  minimumSize: number,
  refine: (box: Bounds) => boolean,
  numerical?: NumericalAllocator
): AdaptiveTopology {
  validateMinimum(minimumSize);
  return refineWhereTree(source, minimumSize, refine, numerical);
}
export function adaptiveCell(topology: AdaptiveTopology, leaf: number): Bounds {
  const at = topology.leaves[leaf] * 4,
    boxes = topology.boxes;
  return [boxes[at], boxes[at + 1], boxes[at + 2], boxes[at + 3]];
}
export function adaptiveLeafAt(topology: AdaptiveTopology, x: number, y: number): number {
  const [x0, y0, x1, y1] = topology.bounds;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return -1;
  if (x < x0 || x > x1 || y < y0 || y > y1) return -1;
  let node = 0;
  while (topology.children[node] >= 0) {
    const at = node * 4;
    const east = x >= (topology.boxes[at] + topology.boxes[at + 2]) / 2;
    const north = y >= (topology.boxes[at + 1] + topology.boxes[at + 3]) / 2;
    node = topology.children[node] + Number(east) + 2 * Number(north);
  }
  return topology.leafIndex[node];
}
export function adaptiveGeometry(topology: AdaptiveTopology, numerical?: NumericalAllocator) {
  const count = topology.leaves.length;
  const vector = (type: "float64" | "uint8", name: string) =>
    allocateNumerical(
      { type, length: count, lifetime: "run", name: `adaptive:${name}` },
      numerical
    );
  const x = vector("float64", "x"),
    y = vector("float64", "y"),
    width = vector("float64", "width"),
    height = vector("float64", "height"),
    areas = vector("float64", "areas"),
    boundary = vector("uint8", "boundary");
  for (let i = 0; i < count; i++) {
    const b = adaptiveCell(topology, i);
    x[i] = (b[0] + b[2]) / 2;
    y[i] = (b[1] + b[3]) / 2;
    width[i] = b[2] - b[0];
    height[i] = b[3] - b[1];
    areas[i] = width[i] * height[i];
    boundary[i] = Number(
      b[0] === topology.bounds[0] ||
        b[1] === topology.bounds[1] ||
        b[2] === topology.bounds[2] ||
        b[3] === topology.bounds[3]
    );
  }
  return { x, y, width, height, areas, boundary };
}
