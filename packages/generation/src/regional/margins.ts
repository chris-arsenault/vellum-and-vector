import { distance, isContent, neighborsOf, regionalSpan } from "./lattice";
import { clamp, type RegionalState } from "./state";

/** Floodplain half-width per square root of mean discharge, in metres. */
const floodWidth = 80;
/** Only low-gradient ground retains floodwater. */
const floodplainGradient = 0.012;
/** Height above the channel a floor reaches (m): a base, more for larger rivers and over sediment. */
const floorRelief = 2,
  floorReliefPerLog = 3;

/**
 * The valley floor (plan: river floodplains as a breadth-first floor, not a one-ring stamp):
 * from each river cell, the ground within a few metres of the channel in the same basin,
 * gently sloping, out to a width that grows with the discharge, taking its sediment with it;
 * so filled valleys widen and incised ones keep narrow floors. A floor reaching the sea at
 * its river's mouth is the delta ground.
 */
export function channelMargins(state: RegionalState) {
  const map = state.physical.map,
    mesh = map.mesh,
    floodplain = new Float64Array(mesh.count),
    delta = new Float64Array(mesh.count);
  for (let i = 0; i < mesh.count; i++)
    if (map.RiverOrders.get(i) > 0 && land(state, i)) floorFrom(state, i, floodplain, delta);
  for (let i = 0; i < mesh.count; i++) {
    if (!isContent(mesh, i)) continue;
    map.FloodplainIntensity.set(i, Math.round(floodplain[i] * 1000));
    map.DeltaIntensity.set(i, Math.round(delta[i] * 1000));
  }
}
const land = (state: RegionalState, i: number) =>
  isContent(state.physical.map.mesh, i) && state.physical.map.WaterKindCodes.get(i) === 0;

/** The floor of one river cell: a breadth-first walk out from it over ground it can flood. */
function floorFrom(
  state: RegionalState,
  source: number,
  floodplain: Float64Array,
  delta: Float64Array
) {
  const map = state.physical.map,
    mesh = map.mesh,
    flow = map.FlowAccumulation.get(source),
    // At least the channel's own ring: a small river's floor is its banks, where the ground is flat.
    width = Math.max(1.5 * regionalSpan(state), floodWidth * Math.sqrt(flow)),
    reach = Math.max(0, floorRelief + floorReliefPerLog * Math.log10(1 + flow)),
    // The channel's surface already carries its deposits; the floor is read from it.
    channel = map.Elevation.get(source) / 1024,
    basin = map.DrainageBasinIds.get(source),
    around = new Int32Array(mesh.stride),
    queue = [source],
    seen = new Set<number>([source]), // hpc-exempt: a few dozen cells around one river cell
    coast = touchesSea(state, source, around);
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head],
      d = distance(mesh, source, i),
      covered =
        clamp(1 - d / Math.max(width, 1)) * clamp(1 - map.Slope.get(i) / floodplainGradient);
    if (i !== source) {
      floodplain[i] = Math.max(floodplain[i], covered);
      if (coast) delta[i] = Math.max(delta[i], covered);
    }
    if (d >= width) continue;
    const m = neighborsOf(mesh, i, around);
    for (let k = 0; k < m; k++) {
      const j = around[k];
      if (seen.has(j) || !land(state, j) || map.DrainageBasinIds.get(j) !== basin) continue;
      if (map.Elevation.get(j) / 1024 - channel > reach) continue;
      seen.add(j);
      queue.push(j);
    }
  }
}
function touchesSea(state: RegionalState, i: number, around: Int32Array) {
  const map = state.physical.map,
    m = neighborsOf(map.mesh, i, around);
  for (let k = 0; k < m; k++) if (map.WaterKindCodes.get(around[k]) === 1) return true;
  return false;
}
