import { resolutionCells, type Band } from "@atlas/domain";
import { channel, distance, neighbors, spacing, type RefinementState } from "./state";
import { referenceDischarge, updateSlopes } from "./terrain";
import { fillRegionalLakes } from "./lakes";
import { downhillRoutes, drainageRoutes, regionalBoundary } from "./drainage";
import { regionalFloodplains } from "./floodplains";

const secondsPerYear = 365.25 * 24 * 3600;
/** Reference-runoff samples a mapped river drains, in this map's own samples. */
const riverCells = 128;
/** Samples a headwater runs before it is drawn as a river. */
const headwaterCells = 4;

function seaConnected(state: RefinementState, datum: number) {
  const g = state.surface,
    sea = g.coverage.scratch("uint8", "regional:sea", g.active.length),
    queue = g.coverage.scratch("int32", "regional:sea-queue", g.active.length);
  let read = 0,
    write = 0;
  for (let i = 0; i < g.active.length; i++)
    if (
      (regionalBoundary(state, i) || g.channels.water?.get(i) === 1) &&
      g.channels.elevation.get(i) <= datum
    ) {
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
  updateSlopes(state);
  const g = state.surface,
    n = g.active.length,
    height = g.channels.elevation,
    datum = channel(state, "seaLevel", "metre").get(0),
    sea = seaConnected(state, datum),
    filled = channel(state, "drainageElevation", "metre"),
    water = channel(state, "water", "category"),
    depth = channel(state, "waterDepth", "metre"),
    level = channel(state, "waterLevel", "metre");
  const { receiver, order, count } = drainageRoutes(state, height, filled, sea, datum);
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
  downhillRoutes(state, state.drainage, filled);
  accumulate(state);
  fillRegionalLakes(state);
  for (let i = 0; i < n; i++) if (water.get(i) !== 0) g.channels.riverOrder.set(i, 0);
  regionalFloodplains(state);
  g.coverage.release(sea);
}
function accumulate(state: RefinementState) {
  const g = state.surface,
    { receiver, order, count } = state.drainage!,
    flow = channel(state, "flow", "cubic-metre/second"),
    area = channel(state, "catchmentArea", "square-metre"),
    runoff = channel(state, "runoff", "metre/year", 0.4),
    river = channel(state, "riverOrder", "category"),
    [dx, dy] = spacing(g),
    cellArea = dx * dy;
  for (let i = 0; i < g.active.length; i++) {
    const land = g.channels.water.get(i) !== 1,
      entering = state.terrain?.inflow.get(i) ?? 0,
      // An entering river drains country beyond the frame, at about reference runoff.
      beyond = (entering / referenceDischarge(state)) * cellArea;
    area.set(i, land ? g.measures.get(i) + beyond : 0);
    flow.set(
      i,
      land ? (Math.max(0, runoff.get(i)) * g.measures.get(i)) / secondsPerYear + entering : 0
    );
    river.set(i, 0);
  }
  for (let k = count - 1; k >= 0; k--) {
    const i = order.get(k),
      j = receiver.get(i);
    if (j < 0) continue;
    area.add(j, area.get(i));
    flow.add(j, flow.get(i));
  }
  qualifyChannels(state, river, flow);
  orderChannels(state, river);
}
/**
 * A mapped river drains at least `riverCells` samples' worth of reference runoff. The
 * threshold is in this map's own samples, so every refinement level shows a similar
 * stream density, while dry or permeable ground needs a larger catchment for the same flow.
 */
function qualifyChannels(state: RefinementState, river: Band, flow: Band) {
  const g = state.surface,
    threshold = riverCells * referenceDischarge(state),
    [dx, dy] = spacing(g),
    span = Math.sqrt(dx * dy),
    flowPath = upstreamLengths(state, () => true);
  // A channel gathers water from a catchment wider than one sample; a strip
  // accumulating down a planar slope is sheet flow, however much it carries.
  for (let i = 0; i < g.active.length; i++)
    if (
      waterLand(state, i) &&
      flow.get(i) >= threshold &&
      g.channels.catchmentArea.get(i) / (flowPath[i] + span) >= resolutionCells * span
    )
      river.set(i, 1);
  // Generalize the network like a map at this scale: a headwater shorter than a few
  // samples (a planar hillslope's parallel rills) is not drawn, and every stream
  // begins once it has run that far. A river entering across the frame edge has
  // already run that far upstream.
  const shortest = headwaterCells * span,
    length = upstreamLengths(
      state,
      (i) => river.get(i) > 0,
      (i) => ((state.terrain?.inflow.get(i) ?? 0) > 0 ? shortest : 0)
    );
  for (let i = 0; i < g.active.length; i++) if (length[i] < shortest) river.set(i, 0);
}
/** Longest upstream path through cells that `along` admits, from each start length. */
function upstreamLengths(
  state: RefinementState,
  along: (i: number) => boolean,
  start: (i: number) => number = () => 0
) {
  const g = state.surface,
    { receiver, order, count } = state.drainage!,
    length = new Float64Array(g.active.length);
  for (let i = 0; i < length.length; i++) length[i] = start(i);
  for (let k = count - 1; k >= 0; k--) {
    const i = order.get(k),
      j = receiver.get(i);
    if (j >= 0 && along(i) && along(j))
      length[j] = Math.max(length[j], length[i] + distance(g, i, j));
  }
  return length;
}
function orderChannels(state: RefinementState, river: Band) {
  const g = state.surface,
    { receiver, order, count } = state.drainage!,
    largest = g.coverage.scratch("int32", "regional:largest-order", g.active.length),
    ties = g.coverage.scratch("int32", "regional:order-ties", g.active.length);
  for (let k = count - 1; k >= 0; k--) {
    const i = order.get(k),
      j = receiver.get(i);
    if (river.get(i)) river.set(i, Math.max(1, largest.get(i) + (ties.get(i) > 1 ? 1 : 0)));
    if (j < 0) continue;
    if (river.get(i) && waterLand(state, j)) river.set(j, Math.max(1, river.get(j)));
    advanceOrder(river, largest, ties, i, j);
  }
  g.coverage.release(largest);
  g.coverage.release(ties);
}
function waterLand(state: RefinementState, i: number) {
  return state.surface.channels.water.get(i) !== 1;
}
function advanceOrder(river: Band, largest: Band, ties: Band, i: number, j: number) {
  if (river.get(i) > largest.get(j)) {
    largest.set(j, river.get(i));
    ties.set(j, 1);
  } else if (river.get(i) === largest.get(j)) ties.add(j, 1);
}
/** Route present water over the developed surface; valleys already formed in the terrain stage. */
export function refineWater(state: RefinementState) {
  routeRegionalWater(state);
}
