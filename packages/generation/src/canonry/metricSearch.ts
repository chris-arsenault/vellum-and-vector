import type { PhysicalMesh } from "./mesh";
import { KeyedHeap, type Band } from "@atlas/domain";

/** Multi-source geodesic distances over physical faces, including coarse/fine interfaces. */
export function metricSearch(
  mesh: PhysicalMesh,
  seeds: Iterable<number>,
  distance: Band,
  reach: number,
  visit: (target: number, source: number) => void
) {
  const queue = new KeyedHeap("min");
  for (const i of seeds) queue.push(i, distance.get(i));
  for (let i = queue.pop(); i >= 0; i = queue.pop()) {
    const d = queue.poppedKey();
    if (d !== distance.get(i)) continue;
    for (let edge = 0; edge < mesh.degree(i); edge++) {
      const j = mesh.neighbor(i, edge),
        next = d + mesh.edgeLength(i, edge);
      if (j < 0 || next > reach || next >= distance.get(j)) continue;
      distance.set(j, next);
      visit(j, i);
      queue.push(j, next);
    }
  }
}
