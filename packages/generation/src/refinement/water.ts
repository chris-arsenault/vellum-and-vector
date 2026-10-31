import { type Band } from "@atlas/domain";
import { channel, clamp, distance, neighbors, spacing, type RefinementState } from "./state";
import { resolutionCells } from "@atlas/domain";
import { relaxSlopes, updateSlopes } from "./terrain";
import { fillRegionalLakes } from "./lakes";
import { physicalProfile } from "../canonry/profile";
import { downhillRoutes, drainageRoutes, regionalBoundary } from "./drainage";
import { inciseRegionalValleys } from "./valleys";
import { settleRegionalPits } from "./terrainStructure";
import { regionalFloodplains } from "./floodplains";
import { concentratedDrainage } from "./channelFormation";

const secondsPerYear = 365.25 * 24 * 3600;
/** Retain the regional catchment support rule as well as requiring actual discharge. */
const headwaterSamples = 12;
/** Mean discharge needed for a flowing stream, independent of the sampling mesh. */
const minimumStreamDischarge = 0.5;
/** Numerical development of this surface, without advancing physical or human time. */
const valleyPasses = 3;

function seaConnected(state: RefinementState, datum: number) {
  const g = state.surface,
    sea = g.coverage.scratch("uint8", "regional:sea", g.active.length),
    queue = g.coverage.scratch("int32", "regional:sea-queue", g.active.length);
  let read = 0,
    write = 0;
  for (let i = 0; i < g.active.length; i++)
    if (regionalBoundary(state, i) && g.channels.elevation.get(i) <= datum) {
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
    river = channel(state, "riverOrder", "category");
  for (let i = 0; i < g.active.length; i++) {
    const land = g.channels.water.get(i) !== 1;
    area.set(i, land ? g.measures.get(i) : 0);
    flow.set(i, land ? (Math.max(0, runoff.get(i)) * g.measures.get(i)) / secondsPerYear : 0);
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
function qualifyChannels(state: RefinementState, river: Band, flow: Band) {
  const g = state.surface,
    [dx, dy] = spacing(g),
    p = physicalProfile,
    gathered = concentratedDrainage(state),
    length = upstreamLengths(state),
    span = Math.sqrt(dx * dy);
  for (let i = 0; i < g.active.length; i++) {
    const slopeFactor = clamp(
      Math.sqrt((g.channels.slope?.get(i) ?? 0) / p.ChannelReferenceSlope),
      p.ChannelSlopeFloor / 1000,
      p.ChannelSlopeCeiling / 1000
    );
    if (
      waterLand(state, i) &&
      gathered.get(i) &&
      g.channels.catchmentArea.get(i) / (length.get(i) + span) >= resolutionCells * span &&
      g.channels.catchmentArea.get(i) >= headwaterSamples * dx * dy &&
      flow.get(i) * slopeFactor >= minimumStreamDischarge
    )
      river.set(i, 1);
  }
  g.coverage.release(gathered);
  g.coverage.release(length);
}
/** An accumulating one-cell strip is sheet flow; a channel gathers a lateral catchment. */
function upstreamLengths(state: RefinementState) {
  const g = state.surface,
    { receiver, order, count } = state.drainage!,
    length = g.coverage.scratch("float64", "regional:upstream-length", g.active.length);
  for (let k = count - 1; k >= 0; k--) {
    const i = order.get(k),
      j = receiver.get(i);
    if (j >= 0) length.set(j, Math.max(length.get(j), length.get(i) + distance(g, i, j)));
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
/** Develop the finer drainage through local feedback, without another geological epoch. */
export function refineWater(state: RefinementState) {
  if (state.input.domains.includes("physical"))
    for (let pass = 0; pass < valleyPasses; pass++) {
      routeRegionalWater(state);
      inciseRegionalValleys(state, valleyPasses);
      relaxSlopes(state);
      settleRegionalPits(state);
    }
  routeRegionalWater(state);
}
