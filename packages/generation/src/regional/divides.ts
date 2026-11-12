import { neighborsOf } from "./lattice";
import { onRiver } from "../water/riverKeeping";
import type { RegionalState } from "./state";

/** A tree over the cells: receivers, and the cells in root-first order. */
interface Tree {
  receiver: Int32Array;
  order: Int32Array;
  count: number;
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
    channel = (i: number) => onRiver(map, i),
    label = segmentLabels(state.regional.drainage!, channel),
    divide = new Uint8Array(mesh.count),
    around = new Int32Array(mesh.stride);
  for (let k = 0; k < count; k++) {
    const i = order[k];
    if (!channel(i)) divide[i] = Number(betweenSegments(mesh, i, label, channel, around));
  }
  return divide;
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
