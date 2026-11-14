import type { Bounds } from "./spatial";
import { requireThat } from "./errors";
import { adaptiveFaces } from "./adaptiveFaces";
import { buildAdaptiveTree } from "./adaptiveTreeBuild";
import { balanceAdaptiveTree } from "./adaptiveTreeBalance";
import { refineSelectedTree, refineWhereTree } from "./adaptiveTreeRefine";
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
export function adaptiveLeafCount(topology: AdaptiveTopology) {
  return topology.leaves.length;
}
export function createAdaptiveTopology(
  bounds: Bounds,
  sampling: AdaptiveSampling,
  cache?: BlockCache
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
    cache
  );
  const balanced = balanceAdaptiveTree(tree);
  return { ...balanced, ...adaptiveFaces(balanced) };
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
  minimumSize: number
): AdaptiveTopology {
  validateMinimum(minimumSize);
  return refineSelectedTree(source, selected, minimumSize);
}
/** Refine requested support and grade its interfaces before building final adjacency. */
export function refineAdaptiveWhere(
  source: AdaptiveTopology,
  minimumSize: number,
  refine: (box: Bounds) => boolean
): AdaptiveTopology {
  validateMinimum(minimumSize);
  return refineWhereTree(source, minimumSize, refine);
}
export function adaptiveCell(topology: AdaptiveTopology, leaf: number): Bounds {
  const at = topology.leaves.get(leaf) * 4,
    boxes = topology.boxes;
  return [boxes.get(at), boxes.get(at + 1), boxes.get(at + 2), boxes.get(at + 3)];
}
export function adaptiveLeafAt(topology: AdaptiveTopology, x: number, y: number): number {
  const [x0, y0, x1, y1] = topology.bounds;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return -1;
  if (x < x0 || x > x1 || y < y0 || y > y1) return -1;
  const { children, boxes } = topology;
  let node = 0;
  for (let child = children.get(0); child >= 0; child = children.get(node)) {
    const at = node * 4;
    const east = x >= (boxes.get(at) + boxes.get(at + 2)) / 2;
    const north = y >= (boxes.get(at + 1) + boxes.get(at + 3)) / 2;
    node = child + Number(east) + 2 * Number(north);
  }
  return topology.leafIndex.get(node);
}
/** Per-leaf geometry bands in the topology's coverage. */
export function adaptiveGeometry(topology: AdaptiveTopology) {
  const count = adaptiveLeafCount(topology),
    coverage = topology.coverage;
  const band = (type: "float64" | "uint8", name: string) => {
    const values = coverage.scratch(type, `adaptive:${name}`, count);
    values.retain();
    return values;
  };
  const x = band("float64", "x"),
    y = band("float64", "y"),
    width = band("float64", "width"),
    height = band("float64", "height"),
    areas = band("float64", "areas"),
    boundary = band("uint8", "boundary");
  const [bx0, by0, bx1, by1] = topology.bounds;
  for (let i = 0; i < count; i++) {
    const [x0, y0, x1, y1] = adaptiveCell(topology, i);
    x.set(i, (x0 + x1) / 2);
    y.set(i, (y0 + y1) / 2);
    width.set(i, x1 - x0);
    height.set(i, y1 - y0);
    areas.set(i, (x1 - x0) * (y1 - y0));
    boundary.set(i, Number(x0 === bx0 || y0 === by0 || x1 === bx1 || y1 === by1));
  }
  return { x, y, width, height, areas, boundary };
}
