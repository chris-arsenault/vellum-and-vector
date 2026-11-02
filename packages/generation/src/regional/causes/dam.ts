import { generationFeatures } from "../../generationFeatures";
import {
  cellAt,
  isContent,
  neighborhood,
  neighborhoodCapacity,
  neighborsOf,
  regionalSpan,
} from "../lattice";
import type { RegionalState } from "../state";
import { registerCause } from "./registry";

/** How far (in cells) a dam record snaps to the channel it holds, and the most a crest rises above the bed (m). */
const damSnap = 2,
  crestLimit = 60;

/**
 * A captured dam holds a reservoir (plan F3): the crest is the lower of the valley's two
 * banks at the dam cell, and the water stage behind it fills the ground below the crest that
 * drains to the dam. Written after each round's water as a lake body, so ecology, Salt and
 * society read a lake where the parent recorded only a point.
 */
registerCause({
  kind: "dam",
  respond(state) {
    if (!state.regional.input.domains.includes("physical")) return;
    const children = upstreamIndex(state);
    let body = nextBody(state);
    for (const f of generationFeatures(state, { areaId: state.regional.input.areaId })) {
      if (f.kind !== "dam" || f.geometry.type !== "Point") continue;
      const [x, y] = f.geometry.coordinates,
        dam = channelNear(state, cellAt(state.physical.map.mesh, x, y));
      if (dam >= 0 && holdReservoir(state, dam, children, body)) body++;
    }
  },
});

/** The river cell nearest a position within the snap distance, or -1. */
export function channelNear(state: RegionalState, cell: number) {
  const map = state.physical.map,
    mesh = map.mesh;
  if (cell < 0) return -1;
  if (map.RiverOrders.get(cell) > 0) return cell;
  const around = new Int32Array(mesh.stride),
    queue = [cell],
    seen = new Set<number>([cell]), // hpc-exempt: a few cells around one dam
    reach = damSnap * regionalSpan(state);
  for (let head = 0; head < queue.length; head++) {
    const m = neighborsOf(mesh, queue[head], around);
    for (let k = 0; k < m; k++) {
      const j = around[k];
      if (seen.has(j) || Math.hypot(mesh.x(j) - mesh.x(cell), mesh.y(j) - mesh.y(cell)) > reach)
        continue;
      if (map.RiverOrders.get(j) > 0) return j;
      seen.add(j);
      queue.push(j);
    }
  }
  return -1;
}

/** Children lists of the drainage tree as packed links. */
function upstreamIndex(state: RegionalState) {
  const { receiver } = state.regional.drainage!,
    n = receiver.length,
    head = new Int32Array(n).fill(-1),
    next = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const j = receiver[i];
    if (j < 0) continue;
    next[i] = head[j];
    head[j] = i;
  }
  return { head, next };
}
function nextBody(state: RegionalState) {
  const map = state.physical.map;
  let body = 1;
  for (let i = 0; i < map.mesh.count; i++) body = Math.max(body, map.WaterBodyIds.get(i) + 1);
  return body;
}

/** Fill the ground draining to the dam that lies below its crest; returns whether any did. */
function holdReservoir(
  state: RegionalState,
  dam: number,
  children: { head: Int32Array; next: Int32Array },
  body: number
) {
  const map = state.physical.map,
    mesh = map.mesh,
    crest = crestAt(state, dam),
    queue: number[] = [];
  for (let c = children.head[dam]; c >= 0; c = children.next[c]) queue.push(c);
  let filled = 0;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    if (!isContent(mesh, i) || map.WaterKindCodes.get(i) === 1 || map.Elevation.get(i) >= crest)
      continue;
    map.WaterKindCodes.set(i, 2);
    map.WaterBodyIds.set(i, body);
    map.WaterDepths.set(i, crest - map.Elevation.get(i));
    map.WaterSurfaceElevations.set(i, crest);
    map.RiverOrders.set(i, 0);
    filled++;
    for (let c = children.head[i]; c >= 0; c = children.next[c]) queue.push(c);
  }
  return filled > 0;
}
/**
 * The crest (native units): the lower of the valley's banks beside the dam cell, read as
 * the second-highest ground around it that is neither channel nor below the bed (the river
 * leaves the cell in some direction; the banks are the ground that stands above it on either
 * side), bounded above the bed.
 */
export function crestAt(state: RegionalState, dam: number) {
  const map = state.physical.map,
    mesh = map.mesh,
    around = new Int32Array(neighborhoodCapacity),
    m = neighborhood(mesh, dam, around),
    bed = map.Elevation.get(dam),
    banks: number[] = [];
  for (let k = 0; k < m; k++) {
    const j = around[k],
      height = map.Elevation.get(j);
    if (map.RiverOrders.get(j) === 0 && map.WaterKindCodes.get(j) === 0 && height > bed)
      banks.push(height);
  }
  banks.sort((a, b) => b - a);
  const bank = banks.length >= 2 ? banks[1] : (banks[0] ?? bed);
  return Math.min(bank, bed + crestLimit * 1024);
}
