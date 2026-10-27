import { allocateNumerical } from "./numericalAllocation";
import type { NumericalAllocator } from "./numericalVector";
import type { SampleType } from "./workspaceResources";
import { visitAdaptiveNeighbors, type AdaptiveFaceTree } from "./adaptiveFaceQuery";

/** Count and write reciprocal interfaces directly; only tree traversal state stays resident. */
export function adaptiveFaces(tree: AdaptiveFaceTree, numerical?: NumericalAllocator) {
  const vector = (type: SampleType, length: number, name: string) =>
    allocateNumerical({ type, length, lifetime: "run", name: `adaptive:${name}` }, numerical);
  const offsets = vector("int32", tree.leaves.length + 1, "offsets");
  for (let i = 0; i < tree.leaves.length; i++) {
    let degree = 0;
    visitAdaptiveNeighbors(tree, i, () => {
      degree++;
    });
    offsets[i + 1] = offsets[i] + degree;
  }
  const count = offsets.at(-1)!,
    neighbors = vector("int32", count, "neighbors"),
    faceLengths = vector("float64", count, "faces"),
    distances = vector("float64", count, "distances"),
    directionX = vector("float64", count, "directionX"),
    directionY = vector("float64", count, "directionY"),
    normalX = vector("int8", count, "normalX"),
    normalY = vector("int8", count, "normalY");
  for (let i = 0; i < tree.leaves.length; i++) {
    const at = tree.leaves[i] * 4;
    let slot = offsets[i];
    visitAdaptiveNeighbors(tree, i, (target, length, nx, ny) => {
      const to = tree.leaves[target] * 4,
        boxes = tree.boxes;
      const dx = (boxes[to] + boxes[to + 2] - boxes[at] - boxes[at + 2]) / 2,
        dy = (boxes[to + 1] + boxes[to + 3] - boxes[at + 1] - boxes[at + 3]) / 2;
      neighbors[slot] = target;
      faceLengths[slot] = length;
      distances[slot] = Math.hypot(dx, dy);
      directionX[slot] = dx / distances[slot];
      directionY[slot] = dy / distances[slot];
      normalX[slot] = nx;
      normalY[slot] = ny;
      slot++;
    });
  }
  return { offsets, neighbors, faceLengths, distances, directionX, directionY, normalX, normalY };
}
