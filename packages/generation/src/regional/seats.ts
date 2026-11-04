import { point } from "@atlas/domain";
import {
  generationFeature,
  generationFeatures,
  writeGenerationFeature,
} from "../generationFeatures";
import { celsius } from "./climate";
import { cellAt, distance, isContent, neighborsOf, positionOf, regionalSpan } from "./lattice";
import { promoteChannel } from "./network";
import { gradeSeat } from "./grading";
import { clamp, type RegionalState, type Seat, type Situation } from "./state";

/** Slope above which a seat's own cell is not usable ground. */
export const usableSlope = 0.12;
/** Reach, as a share of the parent span, within which a seat looks for usable ground. */
const siteReach = 0.6;
/** An established seat's footprint, as a share of the parent span, held to this hillslope gradient. */
const seatFootprintShare = 0.12;
const seatGradient = 0.03;
/** A proposed village holds only its own cell and the ring around it, more gently. */
const proposedGradient = 0.04;

/**
 * The seat operations (spec 6.3); the settlement entry's schedule calls them.
 * Known seats are read from their captured position every run, so a seat an earlier
 * refinement moved is re-sited from the same evidence.
 */
export function knownSeats(state: RegionalState): Seat[] {
  const seats: Seat[] = [];
  for (const f of generationFeatures(state, { areaId: state.regional.input.areaId })) {
    if (f.kind !== "settlement" || f.geometry.type !== "Point") continue;
    const captured = f.attributes.sitedFrom as [number, number] | undefined,
      [x, y] = captured ?? f.geometry.coordinates,
      cell = cellAt(state.physical.map.mesh, x, y);
    if (cell < 0) continue;
    seats.push({
      featureId: f.id,
      cell,
      situation: situationAt(state, cell),
      radius: seatRadius(state),
      gradient: seatGradient,
      strength: "established",
    });
  }
  return seats;
}

export function proposedSeat(state: RegionalState, featureId: string, cell: number): Seat {
  return {
    featureId,
    cell,
    situation: situationAt(state, cell),
    radius: 1,
    gradient: proposedGradient,
    strength: "proposed",
  };
}

export function seatRadius(state: RegionalState) {
  return clamp(
    Math.round((state.regional.parentSpan * seatFootprintShare) / regionalSpan(state)),
    1,
    3
  );
}

/** A seat's broad situation on the present surface: by the sea, by a lake, by a river, or inland. */
export function situationAt(state: RegionalState, cell: number): Situation {
  const map = state.physical.map,
    around = new Int32Array(map.mesh.stride),
    m = neighborsOf(map.mesh, cell, around),
    cells = [cell, ...around.subarray(0, m)],
    water = (kind: number) => cells.some((j) => map.WaterKindCodes.get(j) === kind);
  if (water(1)) return "coast";
  if (water(2)) return "lake";
  if (cells.some((j) => map.RiverOrders.get(j) > 0)) return "river";
  return "inland";
}

export function usableSite(state: RegionalState, i: number) {
  const map = state.physical.map;
  return (
    isContent(map.mesh, i) &&
    map.WaterKindCodes.get(i) === 0 &&
    map.Slope.get(i) <= usableSlope &&
    celsius(state, i) >= -5
  );
}

/**
 * Each seat's footprint holds the hillslope gradient down: the valley floor widens, a shoulder
 * flattens into a bench, a col stays low. The footprint follows the network's own geometry, so
 * the shape is the seat's situation, not a disc. A proposed village counts from round three.
 */
export function seatCaps(state: RegionalState, cap: Float64Array) {
  const mesh = state.physical.map.mesh,
    span = regionalSpan(state),
    seats = (state.regional.evidence?.seats ?? []).filter(
      (seat) => seat.strength === "established" || state.regional.round >= 3
    );
  for (const seat of seats) {
    const reach = (seat.radius + 0.5) * span;
    for (let i = 0; i < mesh.count; i++) {
      const d = distance(mesh, seat.cell, i);
      if (d > reach) continue;
      const gradient = d <= 1.5 * span ? seat.gradient * 0.6 : seat.gradient;
      cap[i] = cap[i] > 0 ? Math.min(cap[i], gradient) : gradient;
    }
  }
}

/** After the network is grown, every river seat stands on a channel: the stream it was built on. */
export function drawChannelsToSeats(state: RegionalState) {
  for (const seat of state.regional.evidence?.seats ?? []) {
    if (seat.situation !== "river") continue;
    const { onChannel, nearest } = channelAround(state, seat.cell);
    if (!onChannel) promoteChannel(state, nearest);
  }
}

/** Whether a channel touches the cell, and the ring's least-flow cell to promote if not. */
function channelAround(state: RegionalState, cell: number) {
  const mesh = state.physical.map.mesh,
    network = state.regional.network!,
    around = new Int32Array(mesh.stride),
    m = neighborsOf(mesh, cell, around);
  let onChannel = Boolean(network.channel[cell]),
    nearest = cell,
    best = network.receiver[cell] < 0 ? Infinity : network.flow[cell];
  for (let k = 0; k < m; k++) {
    const i = around[k];
    onChannel ||= Boolean(network.channel[i]);
    if (network.flow[i] >= best || network.receiver[i] < 0) continue;
    best = network.flow[i];
    nearest = i;
  }
  return { onChannel, nearest };
}

/**
 * Settle every established seat on the derived surface. Its footprint already held the relief
 * down; if the ground under it is still not usable it moves to the best usable ground within
 * reach that keeps its broad situation, and its footprint follows. The captured position is
 * remembered for later runs.
 */
export function settleSeats(state: RegionalState) {
  for (const seat of state.regional.evidence?.seats ?? []) {
    if (seat.strength !== "established") continue;
    const feature = generationFeature(state, seat.featureId);
    if (!feature || feature.geometry.type !== "Point") continue;
    const held = usableSite(state, seat.cell),
      target = held ? seat.cell : bestSite(state, seat),
      from = feature.geometry.coordinates;
    if (target !== seat.cell) {
      seat.cell = target;
      feature.geometry = point(positionOf(state.physical.map.mesh, target));
      // The relief was graded under the old site; the new one is graded where it now stands.
      gradeSeat(state, seat);
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
  const map = state.physical.map,
    mesh = map.mesh,
    reach = state.regional.parentSpan * siteReach;
  let best = seat.cell,
    bestScore = -Infinity;
  for (let i = 0; i < mesh.count; i++) {
    const d = distance(mesh, seat.cell, i);
    if (d > reach || !usableSite(state, i)) continue;
    const score =
      (situationAt(state, i) === seat.situation ? 1 : 0) - map.Slope.get(i) * 10 - d / reach;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}
