import type { PhysicalMesh } from "./mesh";
import { PriorityQueue } from "./priorityQueue";

/** Multi-source geodesic distances over physical faces, including coarse/fine interfaces. */
export function metricSearch(
  mesh: PhysicalMesh,
  seeds: number[],
  distance: Float64Array,
  reach: number,
  visit: (target: number, source: number) => void
) {
  const queue = new PriorityQueue<{ i: number; d: number }>((a, b) => a.d - b.d || a.i - b.i);
  for (const i of seeds) queue.push({ i, d: distance[i] });
  while (queue.count) {
    const { i, d } = queue.pop();
    if (d !== distance[i]) continue;
    for (let edge = 0; edge < mesh.degree[i]; edge++) {
      const at = i * mesh.stride + edge,
        j = mesh.neighbors[at],
        next = d + mesh.edgeLength[at];
      if (j < 0 || next > reach || next >= distance[j]) continue;
      distance[j] = next;
      visit(j, i);
      queue.push({ i: j, d: next });
    }
  }
}
