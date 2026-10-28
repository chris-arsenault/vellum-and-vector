import type { PhysicalMesh } from "./mesh";
import { KeyedHeap, type NumericalVector } from "@atlas/domain";

/** Multi-source geodesic distances over physical faces, including coarse/fine interfaces. */
export function metricSearch(
  mesh: PhysicalMesh,
  seeds: Iterable<number>,
  distance: NumericalVector,
  reach: number,
  visit: (target: number, source: number) => void
) {
  const queue = new KeyedHeap("min");
  for (const i of seeds) queue.push(i, distance[i]);
  for (let i = queue.pop(); i >= 0; i = queue.pop()) {
    const d = queue.poppedKey();
    if (d !== distance[i]) continue;
    for (let edge = 0; edge < mesh.degree[i]; edge++) {
      const at = i * mesh.stride + edge,
        j = mesh.neighbors[at],
        next = d + mesh.edgeLength[at];
      if (j < 0 || next > reach || next >= distance[j]) continue;
      distance[j] = next;
      visit(j, i);
      queue.push(j, next);
    }
  }
}
