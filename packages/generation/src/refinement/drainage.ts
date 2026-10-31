import { KeyedHeap, type Band } from "@atlas/domain";
import { distance, neighbors, type RefinementState } from "./state";

export function regionalBoundary(state: RefinementState, i: number) {
  const g = state.surface,
    x = i % g.width,
    y = Math.floor(i / g.width);
  return x === 0 || y === 0 || x === g.width - 1 || y === g.height - 1;
}

/** A local spill graph, ordered downstream first, over the supplied present heights. */
export function drainageRoutes(
  state: RefinementState,
  height: Band,
  filled: Band,
  sea?: Band,
  datum = 0
) {
  const g = state.surface,
    n = g.active.length,
    receiver = g.coverage.scratch("int32", "regional:receiver", n).fill(-1),
    order = g.coverage.scratch("int32", "regional:drainage-order", n),
    visited = g.coverage.scratch("uint8", "regional:flood-seen", n),
    heap = new KeyedHeap();
  filled.copyFrom(height);
  for (let i = 0; i < n; i++)
    if (outlet(state, i, sea)) {
      const ocean = Boolean(sea?.get(i));
      visited.set(i, 1);
      const level = ocean ? datum : height.get(i);
      heap.push(i, level);
      filled.set(i, level);
    }
  let count = 0;
  while (heap.size) {
    const i = heap.pop();
    order.set(count++, i);
    for (const j of neighbors(g, i))
      if (!visited.get(j)) {
        visited.set(j, 1);
        receiver.set(j, i);
        const spill = Math.max(height.get(j), filled.get(i));
        filled.set(j, spill);
        heap.push(j, spill);
      }
  }
  g.coverage.release(visited);
  return { receiver, order, count };
}

/** Open frame edges drain out, except where a captured river enters across them. */
function outlet(state: RefinementState, i: number, sea?: Band) {
  return (
    Boolean(sea?.get(i)) || (regionalBoundary(state, i) && !(state.terrain?.inflow.get(i) ?? 0))
  );
}

/** The spill tree resolves flats; sloping ground follows its steepest descending neighbor. */
export function downhillRoutes(
  state: RefinementState,
  graph: NonNullable<RefinementState["drainage"]>,
  filled: Band
) {
  const g = state.surface,
    rank = g.coverage.scratch("int32", "regional:flow-rank", g.active.length);
  for (let k = 0; k < graph.count; k++) rank.set(graph.order.get(k), k);
  for (let i = 0; i < g.active.length; i++) {
    if (graph.receiver.get(i) < 0) continue;
    let steepest = 0,
      target = graph.receiver.get(i);
    for (const j of neighbors(g, i)) {
      if (rank.get(j) >= rank.get(i)) continue;
      const slope = (filled.get(i) - filled.get(j)) / distance(g, i, j);
      if (slope > steepest) {
        steepest = slope;
        target = j;
      }
    }
    graph.receiver.set(i, target);
  }
  g.coverage.release(rank);
}
