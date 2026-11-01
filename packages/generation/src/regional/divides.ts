import { Landform } from "../canonry/codes";
import { neighborsOf } from "./lattice";
import type { RegionalState } from "./state";

/**
 * Drainage divides on the routed surface: land cells, off the channels, whose neighbours
 * drain to different channel segments (a segment runs from a head or a confluence to the next
 * confluence). A ridge between two valleys is a divide along its whole crest, and the col
 * where it dips still is one, whichever way the crest's own water runs along it. The world's
 * landform classifier reads this mark where it reads tectonic ridge influence on a world.
 */
export function divides(state: RegionalState) {
  const map = state.physical.map,
    mesh = map.mesh,
    { order, count } = state.regional.drainage!,
    channel = (i: number) => map.RiverOrders.get(i) > 0,
    label = segmentLabels(state, channel),
    divide = new Uint8Array(mesh.count),
    around = new Int32Array(mesh.stride);
  for (let k = 0; k < count; k++) {
    const i = order[k];
    if (!channel(i)) divide[i] = Number(betweenSegments(mesh, i, label, channel, around));
  }
  return divide;
}

/**
 * Passes on the classified field: a ridge cell that is a low point along the divide it stands
 * on (its divide neighbours are higher, none lower) is the col between two summits. The
 * world's own pass rule reads its wide sampling ring, which at a region's scale sees the
 * flanks either side of a col more than the crest, so the col is read along the divide.
 */
export function markPasses(state: RegionalState, divide: Uint8Array) {
  const map = state.physical.map,
    mesh = map.mesh,
    around = new Int32Array(mesh.stride);
  for (let i = 0; i < mesh.count; i++) {
    if (!divide[i] || map.LandformCodes.get(i) !== Landform.Ridge) continue;
    const m = neighborsOf(mesh, i, around);
    let higher = 0,
      lower = 0;
    for (let k = 0; k < m; k++) {
      const j = around[k];
      if (!divide[j]) continue;
      if (map.Elevation.get(j) > map.Elevation.get(i)) higher++;
      else if (map.Elevation.get(j) < map.Elevation.get(i)) lower++;
    }
    if (higher >= 2 && lower === 0) map.LandformCodes.set(i, Landform.Pass);
  }
}

/** The channel segment each cell's water first reaches, as the id of that segment's lowest cell. */
function segmentLabels(state: RegionalState, channel: (i: number) => boolean) {
  const n = state.physical.map.mesh.count,
    { receiver, order, count } = state.regional.drainage!,
    joins = new Uint8Array(n),
    label = new Int32Array(n).fill(-1);
  for (let k = 0; k < count; k++) {
    const i = order[k],
      j = receiver[i];
    if (j >= 0 && channel(i) && channel(j)) joins[j] = Math.min(2, joins[j] + 1);
  }
  for (let k = 0; k < count; k++) {
    const i = order[k],
      j = receiver[i],
      continues = j >= 0 && (!channel(i) || (channel(j) && joins[j] < 2));
    label[i] = continues ? label[j] : i;
  }
  return label;
}

/** A cell beside ground of another segment, and not itself on a channel bank. */
function betweenSegments(
  mesh: RegionalState["physical"]["map"]["mesh"],
  i: number,
  label: Int32Array,
  channel: (i: number) => boolean,
  around: Int32Array
) {
  const m = neighborsOf(mesh, i, around);
  let other = false;
  for (let n = 0; n < m; n++) {
    const j = around[n];
    if (channel(j)) return false;
    if (label[j] >= 0 && label[j] !== label[i]) other = true;
  }
  return other;
}
