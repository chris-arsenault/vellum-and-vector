import type { AdaptiveTopology } from "./adaptiveTopology";
import type { Bounds } from "./spatial";
import type { NumericalAllocator } from "./numericalVector";
import { allocateNumerical } from "./numericalAllocation";
import { requireThat } from "./errors";

export type AdaptiveTreeData = Pick<
  AdaptiveTopology,
  "bounds" | "boxes" | "children" | "levels" | "leaves" | "leafIndex"
>;
export function treeBox(tree: AdaptiveTreeData, node: number): Bounds {
  const at = node * 4,
    b = tree.boxes;
  return [b[at], b[at + 1], b[at + 2], b[at + 3]];
}
export function splitTreeBox(box: Bounds): Bounds[] {
  const [x0, y0, x1, y1] = box,
    x = (x0 + x1) / 2,
    y = (y0 + y1) / 2;
  requireThat(
    x > x0 && x < x1 && y > y0 && y < y1,
    "adaptive_precision",
    "Adaptive cells must remain distinguishable in world coordinates."
  );
  return [
    [x0, y0, x, y],
    [x, y0, x1, y],
    [x0, y, x, y1],
    [x, y, x1, y1],
  ];
}
export function allocateAdaptiveTree(
  bounds: Bounds,
  nodes: number,
  leaves: number,
  numerical?: NumericalAllocator
): AdaptiveTreeData {
  const vector = (type: "float64" | "int32" | "uint8", length: number, name: string) =>
    allocateNumerical({ type, length, lifetime: "run", name: `adaptive:${name}` }, numerical);
  return {
    bounds,
    boxes: vector("float64", nodes * 4, "boxes"),
    children: vector("int32", nodes, "children").fill(-1),
    levels: vector("uint8", nodes, "levels"),
    leaves: vector("int32", leaves, "leaves"),
    leafIndex: vector("int32", nodes, "leafIndex").fill(-1),
  };
}
export function releaseAdaptiveTree(tree: AdaptiveTreeData, numerical?: NumericalAllocator) {
  if (numerical)
    for (const array of [tree.boxes, tree.children, tree.levels, tree.leaves, tree.leafIndex])
      numerical.release(array);
}
export function sourceTreeNode(source: AdaptiveTreeData, box: Bounds, level: number) {
  const x = (box[0] + box[2]) / 2,
    y = (box[1] + box[3]) / 2;
  let node = 0;
  while (source.children[node] >= 0 && source.levels[node] < level) {
    const b = treeBox(source, node);
    node =
      source.children[node] + Number(x >= (b[0] + b[2]) / 2) + 2 * Number(y >= (b[1] + b[3]) / 2);
  }
  return node;
}
