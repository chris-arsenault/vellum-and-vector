import type { SampleType } from "./workspaceResources";
import { visitAdaptiveNeighbors, type AdaptiveFaceTree } from "./adaptiveFaceQuery";
import type { AdaptiveTreeData } from "./adaptiveTree";

/** Count and write reciprocal interfaces directly; only tree traversal state stays resident. */
export function adaptiveFaces(tree: AdaptiveFaceTree & Pick<AdaptiveTreeData, "coverage">) {
  const band = (type: SampleType, length: number, name: string) => {
    const values = tree.coverage.scratch(type, `adaptive:${name}`, length);
    values.retain();
    return values;
  };
  const leaves = tree.leaves.length,
    offsets = band("int32", leaves + 1, "offsets");
  for (let i = 0; i < leaves; i++) {
    let degree = 0;
    visitAdaptiveNeighbors(tree, i, () => {
      degree++;
    });
    offsets.set(i + 1, offsets.get(i) + degree);
  }
  const count = offsets.get(leaves),
    neighbors = band("int32", count, "neighbors"),
    faceLengths = band("float64", count, "faces"),
    distances = band("float64", count, "distances"),
    directionX = band("float64", count, "directionX"),
    directionY = band("float64", count, "directionY"),
    normalX = band("int8", count, "normalX"),
    normalY = band("int8", count, "normalY");
  const boxes = tree.boxes;
  for (let i = 0; i < leaves; i++) {
    const at = tree.leaves.get(i) * 4;
    let slot = offsets.get(i);
    visitAdaptiveNeighbors(tree, i, (target, length, nx, ny) => {
      const to = tree.leaves.get(target) * 4;
      const dx = (boxes.get(to) + boxes.get(to + 2) - boxes.get(at) - boxes.get(at + 2)) / 2,
        dy = (boxes.get(to + 1) + boxes.get(to + 3) - boxes.get(at + 1) - boxes.get(at + 3)) / 2,
        distance = Math.hypot(dx, dy);
      neighbors.set(slot, target);
      faceLengths.set(slot, length);
      distances.set(slot, distance);
      directionX.set(slot, dx / distance);
      directionY.set(slot, dy / distance);
      normalX.set(slot, nx);
      normalY.set(slot, ny);
      slot++;
    });
  }
  return { offsets, neighbors, faceLengths, distances, directionX, directionY, normalX, normalY };
}
