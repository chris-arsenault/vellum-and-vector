import type { AdaptiveTopology } from "./adaptiveTopology";
import type { Bounds } from "./spatial";
import { requireThat } from "./errors";
import type { BlockCache } from "./lattice/blockCache";
import { sampleCoverage } from "./lattice/bandValues";
import type { SampleType } from "./workspaceResources";

export type AdaptiveTreeData = Pick<
  AdaptiveTopology,
  "bounds" | "coverage" | "boxes" | "children" | "levels" | "leaves" | "leafIndex"
>;
export function treeBox(tree: AdaptiveTreeData, node: number): Bounds {
  const at = node * 4,
    b = tree.boxes;
  return [b.get(at), b.get(at + 1), b.get(at + 2), b.get(at + 3)];
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
/** A tree's bands in a new coverage of one cell per leaf, paging through `cache`. */
export function allocateAdaptiveTree(
  bounds: Bounds,
  nodes: number,
  leaves: number,
  cache?: BlockCache
): AdaptiveTreeData {
  const coverage = sampleCoverage(leaves, cache);
  const band = (type: SampleType, length: number, name: string, initial = 0) => {
    const values = coverage.scratch(type, `adaptive:${name}`, length, initial);
    values.retain();
    return values;
  };
  return {
    bounds,
    coverage,
    boxes: band("float64", nodes * 4, "boxes"),
    children: band("int32", nodes, "children", -1),
    levels: band("uint8", nodes, "levels"),
    leaves: band("int32", leaves, "leaves"),
    leafIndex: band("int32", nodes, "leafIndex", -1),
  };
}
export function releaseAdaptiveTree(tree: AdaptiveTreeData) {
  for (const band of [tree.boxes, tree.children, tree.levels, tree.leaves, tree.leafIndex])
    tree.coverage.release(band);
}
export function sourceTreeNode(source: AdaptiveTreeData, box: Bounds, level: number) {
  const x = (box[0] + box[2]) / 2,
    y = (box[1] + box[3]) / 2;
  let node = 0;
  for (
    let child = source.children.get(0);
    child >= 0 && source.levels.get(node) < level;
    child = source.children.get(node)
  ) {
    const b = treeBox(source, node);
    node = child + Number(x >= (b[0] + b[2]) / 2) + 2 * Number(y >= (b[1] + b[3]) / 2);
  }
  return node;
}
