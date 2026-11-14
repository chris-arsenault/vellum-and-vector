import type { SampleType } from "./workspaceResources";
import { visitAdaptiveNeighbors, type AdaptiveFaceTree } from "./adaptiveFaceQuery";
import type { AdaptiveTreeData } from "./adaptiveTree";
import { BandList } from "./lattice/bandList";

/**
 * Write reciprocal interfaces in one traversal: face columns grow in band lists and the
 * offsets follow the running face count. Only tree traversal state stays resident.
 */
export function adaptiveFaces(tree: AdaptiveFaceTree & Pick<AdaptiveTreeData, "coverage">) {
  const coverage = tree.coverage,
    list = (type: SampleType, name: string) => new BandList(coverage, type, `adaptive:${name}`);
  const leaves = tree.leaves.length,
    offsets = coverage.scratch("int32", "adaptive:offsets", leaves + 1),
    columns = {
      neighbors: list("int32", "neighbors"),
      faceLengths: list("float64", "faces"),
      distances: list("float64", "distances"),
      directionX: list("float64", "directionX"),
      directionY: list("float64", "directionY"),
      normalX: list("int8", "normalX"),
      normalY: list("int8", "normalY"),
    };
  const boxes = tree.boxes;
  for (let i = 0; i < leaves; i++) {
    const at = tree.leaves.get(i) * 4;
    offsets.set(i, columns.neighbors.length);
    visitAdaptiveNeighbors(tree, i, (target, length, nx, ny) => {
      const to = tree.leaves.get(target) * 4;
      const dx = (boxes.get(to) + boxes.get(to + 2) - boxes.get(at) - boxes.get(at + 2)) / 2,
        dy = (boxes.get(to + 1) + boxes.get(to + 3) - boxes.get(at + 1) - boxes.get(at + 3)) / 2,
        distance = Math.hypot(dx, dy);
      columns.neighbors.push(target);
      columns.faceLengths.push(length);
      columns.distances.push(distance);
      columns.directionX.push(dx / distance);
      columns.directionY.push(dy / distance);
      columns.normalX.push(nx);
      columns.normalY.push(ny);
    });
  }
  offsets.set(leaves, columns.neighbors.length);
  offsets.retain();
  const finish = (values: BandList) => {
    const band = values.finish();
    band.retain();
    return band;
  };
  return {
    offsets,
    neighbors: finish(columns.neighbors),
    faceLengths: finish(columns.faceLengths),
    distances: finish(columns.distances),
    directionX: finish(columns.directionX),
    directionY: finish(columns.directionY),
    normalX: finish(columns.normalX),
    normalY: finish(columns.normalY),
  };
}
