import type { Bounds } from "./spatial";
import { requireThat } from "./errors";
import { adaptiveFaces } from "./adaptiveFaces";

/** Serializable quadtree and reciprocal control-volume interfaces. */
export interface AdaptiveTopology {
  bounds: Bounds;
  boxes: Float64Array;
  children: Int32Array;
  levels: Uint8Array;
  leaves: Int32Array;
  leafIndex: Int32Array;
  offsets: Int32Array;
  neighbors: Int32Array;
  faceLengths: Float64Array;
  distances: Float64Array;
  directionX: Float64Array;
  directionY: Float64Array;
  normalX: Int8Array;
  normalY: Int8Array;
}
export interface AdaptiveNode {
  bounds: Bounds;
  level: number;
  child: number;
}
export interface AdaptiveSampling {
  maximumSize: number;
  minimumSize: number;
  refine?: (bounds: Bounds, level: number) => boolean;
}
export function splitAdaptiveNode(nodes: AdaptiveNode[], index: number) {
  const node = nodes[index],
    [x0, y0, x1, y1] = node.bounds;
  const x = (x0 + x1) / 2,
    y = (y0 + y1) / 2;
  requireThat(
    x > x0 && x < x1 && y > y0 && y < y1,
    "adaptive_precision",
    "Adaptive cells must remain distinguishable in world coordinates."
  );
  node.child = nodes.length;
  for (const bounds of [
    [x0, y0, x, y],
    [x, y0, x1, y],
    [x0, y, x, y1],
    [x, y, x1, y1],
  ])
    nodes.push({ bounds: bounds as Bounds, level: node.level + 1, child: -1 });
}
export function assembleAdaptiveTopology(bounds: Bounds, nodes: AdaptiveNode[]): AdaptiveTopology {
  const leaves = Int32Array.from(nodes.flatMap((node, i) => (node.child < 0 ? [i] : [])));
  const leafIndex = new Int32Array(nodes.length).fill(-1);
  leaves.forEach((node, i) => {
    leafIndex[node] = i;
  });
  const tree = {
    bounds,
    boxes: Float64Array.from(nodes.flatMap((node) => node.bounds)),
    children: Int32Array.from(nodes, (node) => node.child),
    levels: Uint8Array.from(nodes, (node) => node.level),
    leaves,
    leafIndex,
  };
  return { ...tree, ...adaptiveFaces(tree) };
}
export function createAdaptiveTopology(
  bounds: Bounds,
  sampling: AdaptiveSampling
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
  const nodes: AdaptiveNode[] = [{ bounds: [...bounds], level: 0, child: -1 }];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i],
      size = Math.max(node.bounds[2] - node.bounds[0], node.bounds[3] - node.bounds[1]);
    if (
      size > sampling.maximumSize ||
      (size > sampling.minimumSize && sampling.refine?.(node.bounds, node.level))
    )
      splitAdaptiveNode(nodes, i);
  }
  return balanceAdaptiveTopology(bounds, nodes);
}
/** Grade adjacent cells 2:1 so a narrow feature is not reconstructed against a distant coarse sample. */
function balanceAdaptiveTopology(bounds: Bounds, nodes: AdaptiveNode[]): AdaptiveTopology {
  for (;;) {
    const tree = assembleAdaptiveTopology(bounds, nodes),
      split = new Set<number>();
    for (let i = 0; i < tree.leaves.length; i++)
      for (let at = tree.offsets[i]; at < tree.offsets[i + 1]; at++) {
        const node = tree.leaves[i],
          next = tree.leaves[tree.neighbors[at]];
        if (tree.levels[next] > tree.levels[node] + 1) split.add(node);
      }
    if (!split.size) return tree;
    for (const node of split) splitAdaptiveNode(nodes, node);
  }
}
export function refineAdaptiveTopology(
  source: AdaptiveTopology,
  selected: Iterable<number>,
  minimumSize: number
): AdaptiveTopology {
  requireThat(
    Number.isFinite(minimumSize) && minimumSize > 0,
    "adaptive_resolution",
    "Refinement requires a positive physical minimum size."
  );
  const nodes: AdaptiveNode[] = Array.from(source.children, (child, i) => ({
    child,
    level: source.levels[i],
    bounds: Array.from(source.boxes.subarray(i * 4, i * 4 + 4)) as Bounds,
  }));
  for (const i of new Set(selected)) {
    const node = source.leaves[i],
      b = nodes[node].bounds;
    if (Math.max(b[2] - b[0], b[3] - b[1]) > minimumSize) splitAdaptiveNode(nodes, node);
  }
  return balanceAdaptiveTopology(source.bounds, nodes);
}
/** Request a complete physical support in one tree walk, then grade its interfaces once. */
export function refineAdaptiveWhere(
  source: AdaptiveTopology,
  minimumSize: number,
  refine: (box: Bounds) => boolean
) {
  const nodes: AdaptiveNode[] = Array.from(source.children, (child, i) => ({
    child,
    level: source.levels[i],
    bounds: Array.from(source.boxes.subarray(i * 4, i * 4 + 4)) as Bounds,
  }));
  let changed = false;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i],
      b = node.bounds;
    if (node.child < 0 && Math.max(b[2] - b[0], b[3] - b[1]) > minimumSize && refine(b)) {
      splitAdaptiveNode(nodes, i);
      changed = true;
    }
  }
  return changed ? balanceAdaptiveTopology(source.bounds, nodes) : source;
}
export function adaptiveCell(topology: AdaptiveTopology, leaf: number): Bounds {
  const at = topology.leaves[leaf] * 4;
  return Array.from(topology.boxes.subarray(at, at + 4)) as Bounds;
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
export function adaptiveGeometry(topology: AdaptiveTopology) {
  const count = topology.leaves.length;
  const x = new Float64Array(count),
    y = new Float64Array(count);
  const width = new Float64Array(count),
    height = new Float64Array(count);
  const areas = new Float64Array(count),
    boundary = new Uint8Array(count);
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
