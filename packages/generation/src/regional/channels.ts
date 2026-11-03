import { resolutionCells } from "@atlas/domain";
import { distance, frameEdge, isContent, regionalSpan } from "./lattice";
import { clamp, type RegionalState } from "./state";

/** Samples a headwater runs before it is drawn as a river. */
const headwaterCells = 4;

/** Discharge a captured river brings across the frame edge at this cell (m³/s). */
export function enteringFlow(state: RegionalState, i: number) {
  return state.regional.network?.inflow[i] ?? 0;
}

/**
 * A mapped river follows the world's rule, in discharge rather than in this map's samples:
 * its basin's outlet carries at least the profile's minimum basin discharge (a coastal slope
 * of a few hundred km² draws no river however fine the map), and a channel begins at a share
 * of that outlet discharge, earlier on steep ground. A finer map draws the same rivers more
 * precisely; it does not add a river to every small catchment.
 */
export function qualifyChannels(state: RegionalState) {
  const map = state.physical.map,
    mesh = map.mesh,
    p = state.physical.profile,
    peak = basinPeaks(state),
    span = regionalSpan(state),
    flowPath = upstreamLengths(state, () => true);
  const threshold = (i: number) =>
    clamp(
      (peak.get(map.DrainageBasinIds.get(i))! * p.RiverBasinHeadwaterFraction) / 1000,
      p.RiverMinimumAccumulationThreshold,
      p.RiverAccumulationThreshold
    ) * slopeFactor(state, i);
  // A basin that leaves across the frame edge is larger than its part in the frame: the floor
  // is the whole basin's, so it is not judged on the part this map holds.
  const floor = (i: number) => {
    const basin = map.DrainageBasinIds.get(i);
    return leavesFrame(state, basin - 1) || peak.get(basin)! >= p.RiverMinimumBasinDischarge;
  };
  for (let i = 0; i < mesh.count; i++)
    if (
      isContent(mesh, i) &&
      map.WaterKindCodes.get(i) !== 1 &&
      floor(i) &&
      map.FlowAccumulation.get(i) >= threshold(i) &&
      // A channel gathers water from a catchment wider than one sample; a strip
      // accumulating down a planar slope is sheet flow, however much it carries.
      map.CatchmentArea.get(i) / (flowPath[i] + span) >= resolutionCells * span
    )
      map.RiverOrders.set(i, 1);
  // Generalize the network like a map at this scale: a headwater shorter than a few
  // samples (a planar hillslope's parallel rills) is not drawn, and every stream
  // begins once it has run that far. A river entering across the frame edge has
  // already run that far upstream.
  const shortest = headwaterCells * span,
    length = upstreamLengths(
      state,
      (i) => map.RiverOrders.get(i) > 0,
      (i) => (enteringFlow(state, i) > 0 ? shortest : 0)
    );
  for (let i = 0; i < mesh.count; i++) if (length[i] < shortest) map.RiverOrders.set(i, 0);
}
/** Whether a basin's outlet cell drains out of the frame rather than to the sea or a sink. */
function leavesFrame(state: RegionalState, outlet: number) {
  const map = state.physical.map,
    mesh = map.mesh;
  if (outlet < 0 || map.WaterKindCodes.get(outlet) === 1) return false;
  return !isContent(mesh, outlet) || mesh.boundary(outlet) || frameEdge(mesh, outlet);
}
/** Each drainage basin's largest discharge (its outlet's, m³/s), by basin id. */
function basinPeaks(state: RegionalState) {
  const map = state.physical.map,
    peak = new Map<number, number>();
  for (let i = 0; i < map.mesh.count; i++) {
    const basin = map.DrainageBasinIds.get(i);
    peak.set(basin, Math.max(peak.get(basin) ?? 0, map.FlowAccumulation.get(i)));
  }
  return peak;
}
/**
 * The world's channel slope factor: a channel starts at less flow on steep ground and at more
 * on a plain (gullies start earlier on slopes).
 */
function slopeFactor(state: RegionalState, i: number) {
  const p = state.physical.profile;
  return clamp(
    Math.sqrt(p.ChannelReferenceSlope / Math.max(1e-6, state.physical.map.Slope.get(i))),
    1000 / p.ChannelSlopeCeiling,
    1000 / p.ChannelSlopeFloor
  );
}
/** Longest upstream path through cells that `along` admits, from each start length. */
function upstreamLengths(
  state: RegionalState,
  along: (i: number) => boolean,
  start: (i: number) => number = () => 0
) {
  const mesh = state.physical.map.mesh,
    { receiver, order, count } = state.regional.drainage!,
    length = new Float64Array(mesh.count);
  for (let i = 0; i < length.length; i++) length[i] = start(i);
  for (let k = count - 1; k >= 0; k--) {
    const i = order[k],
      j = receiver[i];
    if (j >= 0 && along(i) && along(j))
      length[j] = Math.max(length[j], length[i] + distance(mesh, i, j));
  }
  return length;
}
/** Strahler order down the drainage tree through the mapped channels. */
export function orderChannels(state: RegionalState) {
  const map = state.physical.map,
    mesh = map.mesh,
    river = map.RiverOrders,
    { receiver, order, count } = state.regional.drainage!,
    largest = new Int32Array(mesh.count),
    ties = new Int32Array(mesh.count);
  for (let k = count - 1; k >= 0; k--) {
    const i = order[k],
      j = receiver[i];
    if (river.get(i)) river.set(i, Math.max(1, largest[i] + (ties[i] > 1 ? 1 : 0)));
    if (j < 0) continue;
    if (river.get(i) && map.WaterKindCodes.get(j) !== 1) river.set(j, Math.max(1, river.get(j)));
    if (river.get(i) > largest[j]) {
      largest[j] = river.get(i);
      ties[j] = 1;
    } else if (river.get(i) === largest[j]) ties[j]++;
  }
}
