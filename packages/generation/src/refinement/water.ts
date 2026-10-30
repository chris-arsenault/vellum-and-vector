import { KeyedHeap, type Band } from "@atlas/domain";
import { channel, clamp, distance, neighbors, type RefinementState } from "./state";
import { relaxSlopes, updateSlopes } from "./terrain";
import { fillRegionalLakes } from "./lakes";

const secondsPerYear = 365.25 * 24 * 3600;
/** A mapped regional stream gathers at least this many terrain samples. */
const headwaterSamples = 12;
/** Local channel incision strength in metres, modulated by flow, slope and rock. */
const incisionStrength = 8;

function boundary(state: RefinementState, i: number) {
  const g = state.surface,
    x = i % g.width,
    y = Math.floor(i / g.width);
  return x === 0 || y === 0 || x === g.width - 1 || y === g.height - 1;
}
function seaConnected(state: RefinementState, datum: number) {
  const g = state.surface,
    sea = g.coverage.scratch("uint8", "regional:sea", g.active.length),
    queue = g.coverage.scratch("int32", "regional:sea-queue", g.active.length);
  let read = 0,
    write = 0;
  for (let i = 0; i < g.active.length; i++)
    if (boundary(state, i) && g.channels.elevation.get(i) <= datum) {
      sea.set(i, 1);
      queue.set(write++, i);
    }
  while (read < write) {
    const i = queue.get(read++);
    for (const j of neighbors(g, i))
      if (!sea.get(j) && g.channels.elevation.get(j) <= datum) {
        sea.set(j, 1);
        queue.set(write++, j);
      }
  }
  g.coverage.release(queue);
  return sea;
}
/** Priority flooding establishes local spill levels and an acyclic route to open map edges. */
export function routeRegionalWater(state: RefinementState) {
  const g = state.surface,
    n = g.active.length,
    height = g.channels.elevation,
    datum = channel(state, "seaLevel", "metre").get(0),
    sea = seaConnected(state, datum),
    filled = channel(state, "drainageElevation", "metre"),
    water = channel(state, "water", "category"),
    depth = channel(state, "waterDepth", "metre"),
    level = channel(state, "waterLevel", "metre");
  const { receiver, order, count } = flood(state, sea, filled, datum);
  for (let i = 0; i < n; i++) {
    water.set(i, sea.get(i));
    depth.set(i, sea.get(i) ? Math.max(0, datum - height.get(i)) : 0);
    level.set(i, sea.get(i) ? datum : height.get(i));
  }
  if (state.drainage) {
    g.coverage.release(state.drainage.receiver);
    g.coverage.release(state.drainage.order);
  }
  state.drainage = { receiver, order, count };
  accumulate(state);
  fillRegionalLakes(state);
  g.coverage.release(sea);
}
function flood(state: RefinementState, sea: Band, filled: Band, datum: number) {
  const g = state.surface,
    n = g.active.length,
    height = g.channels.elevation,
    receiver = g.coverage.scratch("int32", "regional:receiver", n).fill(-1),
    order = g.coverage.scratch("int32", "regional:drainage-order", n),
    visited = g.coverage.scratch("uint8", "regional:flood-seen", n),
    heap = new KeyedHeap();
  filled.copyFrom(height);
  for (let i = 0; i < n; i++)
    if (boundary(state, i) || sea.get(i)) {
      visited.set(i, 1);
      heap.push(i, sea.get(i) ? datum : height.get(i));
      if (sea.get(i)) filled.set(i, datum);
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
function accumulate(state: RefinementState) {
  const g = state.surface,
    { receiver, order, count } = state.drainage!,
    flow = channel(state, "flow", "cubic-metre/second"),
    area = channel(state, "catchmentArea", "square-metre"),
    runoff = channel(state, "runoff", "metre/year", 0.4),
    river = channel(state, "riverOrder", "category");
  const largest = g.coverage.scratch("int32", "regional:largest-order", g.active.length),
    ties = g.coverage.scratch("int32", "regional:order-ties", g.active.length);
  for (let i = 0; i < g.active.length; i++) {
    const land = g.channels.water.get(i) !== 1;
    area.set(i, land ? g.measures.get(i) : 0);
    flow.set(i, land ? (Math.max(0, runoff.get(i)) * g.measures.get(i)) / secondsPerYear : 0);
    river.set(i, 0);
  }
  for (let k = count - 1; k >= 0; k--) {
    const i = order.get(k),
      j = receiver.get(i),
      threshold = headwaterSamples * (g.scope.resolution ?? 1) ** 2;
    if (isChannel(state, i, threshold))
      river.set(i, Math.max(1, largest.get(i) + (ties.get(i) > 1 ? 1 : 0)));
    if (j < 0) continue;
    area.add(j, area.get(i));
    flow.add(j, flow.get(i));
    advanceOrder(river, largest, ties, i, j);
  }
  g.coverage.release(largest);
  g.coverage.release(ties);
}
function isChannel(state: RefinementState, i: number, threshold: number) {
  const c = state.surface.channels;
  return c.catchmentArea.get(i) >= threshold && c.flow.get(i) > 0 && c.water.get(i) !== 1;
}
function advanceOrder(river: Band, largest: Band, ties: Band, i: number, j: number) {
  if (river.get(i) > largest.get(j)) {
    largest.set(j, river.get(i));
    ties.set(j, 1);
  } else if (river.get(i) === largest.get(j)) ties.add(j, 1);
}
/** Shape the finer drainage once; this is surface development, not another geological epoch. */
export function refineWater(state: RefinementState) {
  routeRegionalWater(state);
  if (!state.input.domains.includes("physical")) return;
  const g = state.surface,
    erosion = channel(state, "erosion", "metre"),
    sediment = channel(state, "sediment", "metre"),
    rock = channel(state, "rock", "ratio", 1);
  for (let k = state.drainage!.count - 1; k >= 0; k--) {
    const i = state.drainage!.order.get(k),
      j = state.drainage!.receiver.get(i);
    if (j < 0 || g.channels.water.get(i) !== 0 || g.channels.riverOrder.get(i) === 0) continue;
    const slope = Math.max(
        0,
        (g.channels.elevation.get(i) - g.channels.elevation.get(j)) / distance(g, i, j)
      ),
      cut =
        (incisionStrength * Math.log1p(g.channels.flow.get(i)) * Math.sqrt(slope)) /
        clamp(rock.get(i), 0.3, 3);
    g.channels.elevation.add(i, -cut);
    erosion.add(i, cut);
    // Deposited fans emerge where the receiving reach loses slope or meets standing water.
    const deposit = cut * (g.channels.water.get(j) ? 0.7 : 0.15);
    sediment.add(j, deposit);
    g.channels.elevation.add(j, deposit);
  }
  relaxSlopes(state);
  updateSlopes(state);
  routeRegionalWater(state);
}
