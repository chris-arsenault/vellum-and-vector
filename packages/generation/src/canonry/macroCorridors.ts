import type { PhysicalMesh } from "./mesh";
import { PriorityQueue } from "./priorityQueue";

/** Least-cost links between habitat cores, with barriers excluded from the graph. */
export function connectHabitatCores(
  mesh: PhysicalMesh,
  cells: number[],
  cores: number[],
  support: Float64Array
) {
  const { source, parent, crossings } = habitatDistances(mesh, cells, cores, support);
  const groups = Int32Array.from(cores, (_, i) => i),
    result = new Uint8Array(mesh.count),
    root = (i: number) => {
      while (groups[i] !== i) i = groups[i];
      return i;
    },
    mark = (i: number) => {
      while (i >= 0) {
        result[i] = 1;
        i = parent[i];
      }
    };
  for (const { a, b } of crossings.sort((a, b) => a.cost - b.cost)) {
    const first = root(source[a]),
      second = root(source[b]);
    if (first === second) continue;
    groups[second] = first;
    mark(a);
    mark(b);
  }
  for (const i of cores) result[i] = 1;
  return result;
}
function habitatDistances(
  mesh: PhysicalMesh,
  cells: number[],
  cores: number[],
  support: Float64Array
) {
  const admitted = new Set(cells),
    distance = new Float64Array(mesh.count).fill(Infinity),
    source = new Int32Array(mesh.count).fill(-1),
    parent = new Int32Array(mesh.count).fill(-1),
    queue = new PriorityQueue<{ i: number; cost: number }>((a, b) => a.cost - b.cost || a.i - b.i),
    maximum = cells.reduce((v, i) => Math.max(v, support[i]), 0),
    resistance = (i: number, j: number) => 1 / (0.05 + (support[i] + support[j]) / (2 * maximum));
  cores.forEach((i, n) => {
    source[i] = n;
    distance[i] = 0;
    queue.push({ i, cost: 0 });
  });
  while (queue.count) {
    const current = queue.pop(),
      i = current.i;
    if (current.cost !== distance[i]) continue;
    for (let edge = 0; edge < mesh.degree[i]; edge++) {
      const at = i * mesh.stride + edge,
        j = mesh.neighbors[at];
      if (!admitted.has(j)) continue;
      const next = current.cost + mesh.edgeLength[at] * resistance(i, j);
      if (next >= distance[j]) continue;
      distance[j] = next;
      source[j] = source[i];
      parent[j] = i;
      queue.push({ i: j, cost: next });
    }
  }
  const crossings = coreCrossings(mesh, cells, distance, source, resistance);
  return { source, parent, crossings };
}
function coreCrossings(
  mesh: PhysicalMesh,
  cells: number[],
  distance: Float64Array,
  source: Int32Array,
  resistance: (i: number, j: number) => number
) {
  const admitted = new Set(cells),
    crossings: { a: number; b: number; cost: number }[] = [];
  for (const i of cells)
    for (let edge = 0; edge < mesh.degree[i]; edge++) {
      const at = i * mesh.stride + edge,
        j = mesh.neighbors[at];
      if (!admitted.has(j) || source[i] === source[j] || source[i] < 0 || source[j] < 0) continue;
      crossings.push({
        a: i,
        b: j,
        cost: distance[i] + distance[j] + mesh.edgeLength[at] * resistance(i, j),
      });
    }
  return crossings;
}
