import { Landform } from "../canonry/codes";
import { neighborsOf, regionalSpan } from "./lattice";
import { channelCells } from "./network";
import type { RegionalState } from "./state";

/** A tree over the cells: receivers, and the cells in root-first order. */
interface Tree {
  receiver: Int32Array;
  order: Int32Array;
  count: number;
}

/** Catchments this many times the channel threshold stand on the highest crests. */
const trunkCatchments = 64;

/**
 * The divide network of the drainage network (the ridge tree, plan G2): a hillslope cell
 * whose neighbours drain to another channel segment of the network stands on a divide, and
 * the smaller of the two catchments it separates says how far up the ridge tree it stands:
 * the trunk divide between two large basins, the tributary divides between small ones.
 * Returns a crest strength 0..1 per cell (0 off a divide), read by the relief derivation so
 * ridgelines branch like an inverted river and dip to cols between small catchments.
 */
export function networkDivides(state: RegionalState) {
  const mesh = state.physical.map.mesh,
    network = state.regional.network!,
    channel = (i: number) => network.channel[i] === 1,
    label = segmentLabels(network, channel),
    threshold = channelCells * regionalSpan(state) ** 2,
    crest = new Float64Array(mesh.count),
    around = new Int32Array(mesh.stride);
  for (let k = 0; k < network.count; k++) {
    const i = network.order[k];
    if (channel(i) || network.sea[i]) continue;
    const m = neighborsOf(mesh, i, around);
    let smallest = Infinity;
    for (let n = 0; n < m; n++) {
      const j = around[n];
      if (label[j] < 0 || label[j] === label[i] || network.sea[j]) continue;
      // The catchment on the far side, read at the segment's own mouth.
      smallest = Math.min(smallest, network.area[label[j]], network.area[label[i]]);
    }
    if (smallest < Infinity)
      crest[i] = Math.min(1, Math.log2(1 + smallest / threshold) / Math.log2(1 + trunkCatchments));
  }
  return crest;
}

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
    label = segmentLabels(state.regional.drainage!, channel),
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
function segmentLabels(tree: Tree, channel: (i: number) => boolean) {
  const n = tree.receiver.length,
    { receiver, order, count } = tree,
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
