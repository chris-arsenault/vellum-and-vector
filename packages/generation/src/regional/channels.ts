import { resolutionCells } from "@atlas/domain";
import { distance, isContent, regionalSpan } from "./lattice";
import { referenceDischarge } from "./network";
import { holdContinuingChannels } from "../area/riverLineage";
import { clamp, type RegionalState } from "./state";

/** Reference-runoff samples a physical channel drains, in this map's own samples. */
const riverCells = 128;
/** Samples a headwater runs before it is a channel. */
const headwaterCells = 4;
/** Surface gradient at which a channel's threshold is the reference. */
const riverReferenceGradient = 0.02;

/** Discharge a captured river brings across the frame edge at this cell (m³/s). */
export function enteringFlow(state: RegionalState, i: number) {
  return state.regional.network?.inflow[i] ?? 0;
}

/**
 * A physical channel drains at least `riverCells` samples' worth of reference runoff. The
 * threshold is in this map's own samples, so every refinement level resolves a similar
 * channel density, while dry or permeable ground needs a larger catchment for the same flow.
 * These channels are the map's drainage network (latent for a finer map); which of them is a
 * named river is the significance test of the extraction, at the map's scale.
 */
export function qualifyChannels(state: RegionalState) {
  const map = state.physical.map,
    mesh = map.mesh,
    threshold = riverCells * referenceDischarge(state),
    span = regionalSpan(state),
    flowPath = upstreamLengths(state, () => true);
  // The river network's slope factor: a channel starts at less flow on steep ground and at
  // more on a plain (gullies start earlier on slopes), as the network's channels do.
  const slopeFactor = (i: number) =>
    clamp(Math.sqrt(riverReferenceGradient / Math.max(1e-4, map.Slope.get(i))), 0.5, 2);
  for (let i = 0; i < mesh.count; i++)
    if (
      isContent(mesh, i) &&
      map.WaterKindCodes.get(i) !== 1 &&
      map.FlowAccumulation.get(i) >= threshold * slopeFactor(i) &&
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
  holdContinuingChannels(state);
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
