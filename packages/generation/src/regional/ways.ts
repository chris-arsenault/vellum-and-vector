import { KeyedHeap } from "@atlas/domain";
import { distance, isContent, neighborhood, neighborhoodCapacity } from "./lattice";
import type { RegionalState } from "./state";

/** Travel cost of slope, shared by local ways and hinterland competition. */
export const slopeCost = 12;

/** What a path search reads beside the ground: a cost factor per step (worn ways, fords on or under the step) and free links (door ends). */
export interface PathOptions {
  factor?: (i: number, j: number) => number;
  links?: Map<number, number>;
}

/** Search arrays shared by every path on one map; a stamp marks each search's own entries. */
interface PathSearch {
  cost: Float64Array;
  previous: Int32Array;
  stamp: Uint32Array;
  settled: Uint32Array;
  search: number;
}
const searches = new WeakMap<RegionalState, PathSearch>();
function pathSearch(state: RegionalState) {
  const n = state.physical.map.mesh.count;
  let s = searches.get(state);
  if (!s || s.cost.length !== n) {
    s = {
      cost: new Float64Array(n),
      previous: new Int32Array(n),
      stamp: new Uint32Array(n),
      settled: new Uint32Array(n),
      search: 0,
    };
    searches.set(state, s);
  }
  s.search++;
  return s;
}
/**
 * A* over dry, passable ground on the present surface: slope costs travel, the caller's factor
 * discounts worn ground or taxes a crossing, and a link (a door) joins two cells for nothing.
 * The search is sized by this map's cells.
 */
export function regionalPath(
  state: RegionalState,
  start: number,
  end: number,
  options: PathOptions = {}
): number[] | null {
  const map = state.physical.map,
    mesh = map.mesh,
    front = new KeyedHeap(),
    s = pathSearch(state),
    around = new Int32Array(neighborhoodCapacity(mesh)),
    known = (j: number) => (s.stamp[j] === s.search ? s.cost[j] : Infinity),
    height = (i: number) => map.Elevation.get(i) / 1024,
    relax = (i: number, j: number, next: number) => {
      if (next >= known(j)) return;
      s.stamp[j] = s.search;
      s.cost[j] = next;
      s.previous[j] = i;
      front.push(j, next + distance(mesh, j, end));
    };
  s.stamp[start] = s.search;
  s.cost[start] = 0;
  s.previous[start] = -1;
  front.push(start, 0);
  const expand = (i: number) => {
    const linked = options.links?.get(i);
    if (linked !== undefined && isContent(mesh, linked)) relax(i, linked, s.cost[i]);
    const m = neighborhood(mesh, i, around);
    for (let k = 0; k < m; k++) {
      const j = around[k];
      if (!isContent(mesh, j) || map.WaterKindCodes.get(j) !== 0) continue;
      const step = distance(mesh, i, j),
        slope = Math.abs(height(j) - height(i)) / step;
      relax(i, j, s.cost[i] + step * (1 + slope * slopeCost) * (options.factor?.(i, j) ?? 1));
    }
  };
  while (front.size) {
    const i = front.pop();
    if (i === end) return walkPath(s.previous, start, end);
    if (s.settled[i] === s.search) continue;
    s.settled[i] = s.search;
    expand(i);
  }
  return null;
}
function walkPath(previous: Int32Array, start: number, end: number) {
  const cells = [end];
  let i = end;
  while (i !== start) {
    i = previous[i];
    if (i < 0) return null;
    cells.push(i);
  }
  return cells.reverse();
}
