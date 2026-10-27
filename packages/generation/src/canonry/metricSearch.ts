import type { PhysicalMesh } from "./mesh";
import type { NumericalVector, NumericalAllocator } from "@atlas/domain";
import { PriorityQueue } from "./priorityQueue";

/** Multi-source geodesic distances over physical faces, including coarse/fine interfaces. */
export function metricSearch(
  mesh: PhysicalMesh,
  seeds: Iterable<number>,
  distance: NumericalVector,
  reach: number,
  visit: (target: number, source: number) => void,
  numerical?: NumericalAllocator
) {
  const queue = new PriorityQueue<{ i: number; d: number }>(
    (a, b) => a.d - b.d || a.i - b.i,
    numerical,
    ["i", "d"]
  );
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
  queue.close();
}
