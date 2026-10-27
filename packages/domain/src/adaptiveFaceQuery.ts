import type { AdaptiveTopology } from "./adaptiveTopology";

export type AdaptiveFaceTree = Pick<
  AdaptiveTopology,
  "leaves" | "boxes" | "children" | "leafIndex"
>;
/** Traverse the exact adjoining face; no world-wide side maps or floating-point probes. */
export function visitAdaptiveFace(
  tree: AdaptiveFaceTree,
  leaf: number,
  axis: 0 | 1,
  side: -1 | 1,
  visit: (target: number, length: number, nx: number, ny: number) => void,
  lineOffset = 0
) {
  const source = tree.leaves[leaf] * 4,
    boxes = tree.boxes;
  const line = boxes[source + axis + (side > 0 ? 2 : 0)] + lineOffset,
    low = boxes[source + 1 - axis],
    high = boxes[source + 3 - axis],
    normal = [Number(axis === 0) * side, Number(axis === 1) * side];
  const pending = [0];
  while (pending.length) {
    const node = pending.pop()!,
      at = node * 4;
    if (
      !adjoins(boxes[at + axis], boxes[at + axis + 2], line, side) ||
      boxes[at + 1 - axis] >= high ||
      boxes[at + 3 - axis] <= low
    )
      continue;
    const child = tree.children[node];
    if (child >= 0) {
      pending.push(child + 3, child + 2, child + 1, child);
      continue;
    }
    if (boxes[at + axis + (side > 0 ? 0 : 2)] !== line) continue;
    const length = Math.min(high, boxes[at + 3 - axis]) - Math.max(low, boxes[at + 1 - axis]);
    visit(tree.leafIndex[node], length, normal[0], normal[1]);
  }
}
function adjoins(low: number, high: number, line: number, side: number) {
  return side > 0 ? low <= line && high > line : low < line && high >= line;
}
export function visitAdaptiveNeighbors(
  tree: AdaptiveFaceTree,
  leaf: number,
  visit: (target: number, length: number, nx: number, ny: number) => void
) {
  visitAdaptiveFace(tree, leaf, 0, -1, visit);
  visitAdaptiveFace(tree, leaf, 0, 1, visit);
  visitAdaptiveFace(tree, leaf, 1, -1, visit);
  visitAdaptiveFace(tree, leaf, 1, 1, visit);
}
