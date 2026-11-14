import { BitSet, CellList, KeyedHeap } from "@atlas/domain";
import type { PhysicalMesh } from "../world/mesh";
import { distance } from "./lattice";

/** Reusable scratch for placing many small inherited footprints on one mesh. */
export function valleyScratch(count: number) {
  return { inside: new BitSet(count), cost: new Float64Array(count) };
}

/** Shares of occupied valley floor in the supplied placement order. */
export function valleyShares(
  order: readonly number[],
  seeds: number,
  available: number,
  area: (cell: number) => number
) {
  const shares = new Float64Array(order.length),
    courseArea = order.slice(0, seeds).reduce((sum, cell) => sum + area(cell), 0),
    courseShare = courseArea > 0 ? Math.min(1, available / courseArea) : 0;
  for (const [at, cell] of order.entries()) {
    shares[at] = at < seeds ? courseShare : Math.min(1, Math.max(0, available / area(cell)));
    available -= shares[at] * area(cell);
  }
  return shares;
}

/** Connected widening by the actual work of releasing each face, rather than isotropic rings. */
export function valleyOrder(
  mesh: PhysicalMesh,
  cells: readonly number[],
  seeds: readonly number[],
  resistance: (from: number, toward: number) => number,
  scratch = valleyScratch(mesh.count)
) {
  const { inside, cost } = scratch,
    heap = new KeyedHeap(),
    placed = new CellList();
  for (const cell of cells) {
    inside.add(cell);
    cost[cell] = Infinity;
  }
  for (const seed of seeds) {
    cost[seed] = 0;
    heap.push(seed, 0);
  }
  while (heap.size) {
    const cell = heap.pop();
    if (!inside.has(cell)) continue;
    inside.clear(cell);
    placed.push(cell);
    for (let edge = 0; edge < mesh.degree(cell); edge++) {
      const next = mesh.neighbor(cell, edge);
      if (next < 0 || !inside.has(next)) continue;
      const work = cost[cell] + distance(mesh, cell, next) * resistance(next, cell);
      if (work >= cost[next]) continue;
      cost[next] = work;
      heap.push(next, work);
    }
  }
  return remaining(cells, inside, placed);
}
/** Include disconnected pieces of a clipped donor after the connected valley. */
function remaining(cells: readonly number[], inside: BitSet, placed: CellList) {
  for (const cell of cells)
    if (inside.has(cell)) {
      placed.push(cell);
      inside.clear(cell);
    }
  return Array.from(placed.finish());
}
