import { KeyedHeap } from "@atlas/domain";
import type { PhysicalMesh } from "../world/mesh";
import { distance, isContent, neighborhood, neighborhoodCapacity } from "./lattice";
import type { NetworkWork, RegionalState } from "./state";
import { directionalResistance } from "./material";
import { physicalContext } from "../world/context";

/**
 * Initial drainage organization through the captured terrain and present material. This
 * calculation chooses routes, not an unrecorded history of uplift and erosion. The initial
 * relief realization and subsequent shared processes perform the actual Ground changes.
 */
export function evolveNetwork(
  state: RegionalState,
  network: NetworkWork,
  root: Uint8Array,
  resistance: Float64Array
) {
  const context = physicalContext(state.regional.input.seed, 0, state.physical.profile);
  const routed = drainageTree(
    state.physical.map.mesh,
    network.base,
    (from, to) =>
      (directionalResistance(state.physical.map, from, to, context) *
        (resistance[from] + resistance[to])) /
      2,
    root,
    network.level,
    network.sea
  );
  network.receiver.set(routed.receiver);
  network.order.set(routed.order);
  network.cost.set(routed.cost);
  network.count = routed.count;
}

/**
 * A geodesic tree rooted in existing waters and open outlets. Climbing intervening ground
 * costs additional work; resistant material and feature corridors change that work locally.
 * Every receiver was settled first, including across flats, so the result is acyclic.
 */
export function drainageTree(
  mesh: PhysicalMesh,
  height: ArrayLike<number>,
  resistance: ArrayLike<number> | ((from: number, to: number) => number),
  roots: ArrayLike<number>,
  level: ArrayLike<number>,
  sea: ArrayLike<number>
) {
  const receiver = new Int32Array(mesh.count).fill(-1),
    order = new Int32Array(mesh.count),
    cost = new Float64Array(mesh.count).fill(Infinity),
    settled = new Uint8Array(mesh.count),
    around = new Int32Array(neighborhoodCapacity),
    heap = new KeyedHeap(),
    effort =
      typeof resistance === "function"
        ? resistance
        : (from: number, to: number) => (resistance[from] + resistance[to]) / 2;
  for (let i = 0; i < mesh.count; i++)
    if (roots[i]) {
      cost[i] = Math.max(0, level[i]);
      heap.push(i, cost[i]);
    }
  let count = 0;
  while (heap.size) {
    const i = heap.pop();
    if (settled[i]) continue;
    settled[i] = 1;
    order[count++] = i;
    const neighbors = neighborhood(mesh, i, around);
    for (let edge = 0; edge < neighbors; edge++) {
      const j = around[edge];
      if (!admits(mesh, j, settled, roots, sea)) continue;
      const length = distance(mesh, i, j),
        climb = Math.max(0, height[j] - height[i]),
        next = cost[i] + (length + climb) * effort(j, i);
      if (next >= cost[j]) continue;
      receiver[j] = i;
      cost[j] = next;
      heap.push(j, next);
    }
  }
  return { receiver, order, cost, count };
}

function admits(
  mesh: PhysicalMesh,
  cell: number,
  settled: ArrayLike<number>,
  roots: ArrayLike<number>,
  sea: ArrayLike<number>
) {
  return !settled[cell] && !roots[cell] && !sea[cell] && isContent(mesh, cell);
}
