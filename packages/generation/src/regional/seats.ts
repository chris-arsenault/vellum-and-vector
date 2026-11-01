import { point, gridPosition } from "@atlas/domain";
import { generationFeature, writeGenerationFeature } from "../generationFeatures";
import { situationAt } from "./evidence";
import { promoteChannel } from "./network";
import { distance, spacing, type RegionalState, type Seat } from "./state";

/** Slope above which a seat's own cell is not usable ground. */
export const usableSlope = 0.12;
/** Reach, as a share of the parent span, within which a seat looks for usable ground. */
const siteReach = 0.6;

export function usableSite(state: RegionalState, i: number) {
  const c = state.surface.channels;
  return (
    (c.water?.get(i) ?? 0) === 0 &&
    c.slope.get(i) <= usableSlope &&
    (c.temperature?.get(i) ?? 15) >= -5
  );
}

/** After the network is grown, every river seat stands on a channel: the stream it was built on. */
export function drawChannelsToSeats(state: RegionalState) {
  for (const seat of state.evidence?.seats ?? []) {
    if (seat.situation !== "river") continue;
    const { onChannel, nearest } = channelAround(state, seat.cell);
    if (!onChannel) promoteChannel(state, nearest);
  }
}

/** Whether a channel touches the cell, and the ring's least-flow cell to promote if not. */
function channelAround(state: RegionalState, cell: number) {
  const g = state.surface,
    network = state.network!,
    cx = cell % g.width,
    cy = Math.floor(cell / g.width);
  let onChannel = false,
    nearest = cell,
    best = Infinity;
  for (let y = Math.max(0, cy - 1); y <= Math.min(g.height - 1, cy + 1); y++)
    for (let x = Math.max(0, cx - 1); x <= Math.min(g.width - 1, cx + 1); x++) {
      const i = y * g.width + x;
      onChannel ||= Boolean(network.channel[i]);
      if (network.flow[i] >= best || network.receiver[i] < 0) continue;
      best = network.flow[i];
      nearest = i;
    }
  return { onChannel, nearest };
}

/**
 * Settle every seat on the derived surface (spec 6.3). Its footprint already held the relief
 * down; if the ground under it is still not usable it moves to the best usable ground within
 * reach that keeps its broad situation, and its footprint follows, so the next derivation
 * flattens where it actually stands. The captured position is remembered for later runs.
 */
export function settleSeats(state: RegionalState) {
  for (const seat of state.evidence?.seats ?? []) {
    if (seat.strength !== "established") continue;
    const feature = generationFeature(state, seat.featureId);
    if (!feature || feature.geometry.type !== "Point") continue;
    const held = usableSite(state, seat.cell),
      target = held ? seat.cell : bestSite(state, seat),
      from = feature.geometry.coordinates;
    if (target !== seat.cell) {
      seat.cell = target;
      feature.geometry = point(gridPosition(state.surface, target));
    }
    feature.attributes = {
      ...feature.attributes,
      sitedFrom: feature.attributes.sitedFrom ?? [from[0], from[1]],
      support: supportKind(state, held, target),
      situation: situationAt(state, target),
    };
    writeGenerationFeature(state, feature);
  }
}
function supportKind(state: RegionalState, held: boolean, target: number) {
  if (held) return "footprint";
  return usableSite(state, target) ? "moved" : "unsupported";
}

function bestSite(state: RegionalState, seat: Seat) {
  const g = state.surface,
    [dx, dy] = spacing(g),
    reach = state.parentSpan * siteReach,
    rx = Math.ceil(reach / dx),
    ry = Math.ceil(reach / dy),
    cx = seat.cell % g.width,
    cy = Math.floor(seat.cell / g.width);
  let best = seat.cell,
    bestScore = -Infinity;
  for (let y = Math.max(0, cy - ry); y <= Math.min(g.height - 1, cy + ry); y++)
    for (let x = Math.max(0, cx - rx); x <= Math.min(g.width - 1, cx + rx); x++) {
      const i = y * g.width + x,
        d = distance(g, seat.cell, i);
      if (d > reach || !usableSite(state, i)) continue;
      const score =
        (situationAt(state, i) === seat.situation ? 1 : 0) -
        g.channels.slope.get(i) * 10 -
        d / reach;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
  return best;
}
