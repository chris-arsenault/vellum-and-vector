import { neighborsOf } from "./lattice";
import { onRiver, riverSuccessor } from "../water/riverKeeping";
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
    label = segmentLabels(state.regional.drainage!, channel, (cell) => riverSuccessor(map, cell)),
    divide = new Uint8Array(mesh.count),
    around = new Int32Array(mesh.stride);
  for (let k = 0; k < count; k++) {
    const i = order[k];
    if (!channel(i)) divide[i] = Number(betweenSegments(mesh, i, label, channel, around));
  }
  return divide;
}

/** Owned segments are labelled first; only off-channel catchments follow terrain drainage. */
export function segmentLabels(
  tree: Tree,
  channel: (cell: number) => boolean,
  successor: (cell: number) => number
) {
  const { member, next } = channelTopology(tree.receiver.length, channel, successor),
    label = channelLabels(member, next);
  for (let k = 0; k < tree.count; k++) {
    const cell = tree.order[k];
    if (member[cell]) continue;
    const target = tree.receiver[cell];
    label[cell] = target >= 0 ? label[target] : cell;
  }
  return label;
}

function channelTopology(
  count: number,
  channel: (cell: number) => boolean,
  successor: (cell: number) => number
) {
  const member = Uint8Array.from({ length: count }, (_, cell) => Number(channel(cell))),
    next = new Int32Array(count).fill(-1);
  for (let cell = 0; cell < count; cell++) {
    if (!member[cell]) continue;
    const target = successor(cell);
    if (target >= 0 && member[target]) next[cell] = target;
  }
  return { member, next };
}

function channelLabels(member: Uint8Array, next: Int32Array) {
  const joins = new Uint8Array(next.length),
    label = new Int32Array(next.length).fill(-1),
    stack = new Int32Array(next.length);
  for (const target of next) if (target >= 0) joins[target] = Math.min(2, joins[target] + 1);
  for (let cell = 0; cell < next.length; cell++)
    if (member[cell] && label[cell] < 0) labelChannelPath(cell, next, joins, label, stack);
  return label;
}

/** Memoized channel chains need their own order; the terrain tree may point another way. */
function labelChannelPath(
  cell: number,
  next: Int32Array,
  joins: Uint8Array,
  label: Int32Array,
  stack: Int32Array
) {
  let end = cell,
    count = 0;
  while (label[end] === -1) {
    label[end] = -2;
    stack[count++] = end;
    const target = next[end];
    if (target < 0 || joins[target] >= 2) {
      label[end] = end;
      break;
    }
    end = target;
  }
  if (label[end] === -2) throw new Error("Retained channel segments contain a cycle.");
  while (count) {
    const at = stack[--count],
      target = next[at];
    label[at] = target >= 0 && joins[target] < 2 ? label[target] : at;
  }
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
