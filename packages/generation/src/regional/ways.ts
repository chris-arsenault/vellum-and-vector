import {
  gridPosition,
  spatial,
  translateGeometry,
  KeyedHeap,
  type AtlasFeature,
} from "@atlas/domain";
import { regionalCommunitySpacing } from "../regionalSociety";
import { putRegionalFeature, putRegionalNetwork } from "./extraction/features";
import { distance, neighbors, type RegionalState } from "./state";

/** Travel cost of slope, shared by local ways and hinterland competition. */
export const slopeCost = 12;

/** Connect each seat to its nearest neighbour by a local way over dry, passable ground. */
export function connectSeats(
  state: RegionalState,
  seats: { feature: AtlasFeature; cell: number }[]
) {
  if (seats.length < 2) return;
  const shapes = seats.map((s) => {
      const p = gridPosition(state.surface, s.cell),
        coordinate = (s.feature.geometry as GeoJSON.Point).coordinates;
      return translateGeometry(s.feature.geometry, p.x - coordinate[0]);
    }),
    pairs = new Set<string>(),
    size = regionalCommunitySpacing(state) * 3;
  spatial.withIndex(shapes, (index) => {
    for (const [a, seat] of seats.entries()) {
      const p = gridPosition(state.surface, seat.cell),
        nearby = index
          .query([p.x - size, p.y - size, p.x + size, p.y + size])
          .filter((b) => b !== a && seats[b].cell !== seat.cell)
          .sort(
            (b, c) =>
              distance(state.surface, seat.cell, seats[b].cell) -
              distance(state.surface, seat.cell, seats[c].cell)
          ),
        b = nearby[0];
      if (b === undefined) continue;
      const key = [a, b].sort((x, y) => x - y).join(":");
      if (pairs.has(key)) continue;
      pairs.add(key);
      publishWay(state, key, seat, seats[b]);
    }
  });
}

function publishWay(
  state: RegionalState,
  key: string,
  from: { feature: AtlasFeature; cell: number },
  to: { feature: AtlasFeature; cell: number }
) {
  const cells = regionalPath(state, from.cell, to.cell);
  if (!cells || cells.length < 2) return;
  const coordinates = cells.map((i) => {
      const p = gridPosition(state.surface, i);
      return [p.x, p.y];
    }),
    f = putRegionalFeature(
      state,
      `way:${key}`,
      "road",
      "roads",
      { type: "LineString", coordinates },
      { from: from.feature.id, to: to.feature.id, routeType: "local" },
      "Local way"
    );
  putRegionalNetwork(state, f, 0, coordinates);
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
  const n = state.surface.active.length;
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
/** A* follows dry, passable ground; the search is sized by this map's cells. */
export function regionalPath(state: RegionalState, start: number, end: number): number[] | null {
  const g = state.surface,
    front = new KeyedHeap(),
    s = pathSearch(state),
    known = (j: number) => (s.stamp[j] === s.search ? s.cost[j] : Infinity);
  s.stamp[start] = s.search;
  s.cost[start] = 0;
  s.previous[start] = -1;
  front.push(start, 0);
  while (front.size) {
    const i = front.pop();
    if (i === end) return walkPath(s.previous, start, end);
    if (s.settled[i] === s.search) continue;
    s.settled[i] = s.search;
    for (const j of neighbors(g, i)) {
      if (g.channels.water.get(j) !== 0) continue;
      const slope =
          Math.abs(g.channels.elevation.get(j) - g.channels.elevation.get(i)) / distance(g, i, j),
        next = s.cost[i] + distance(g, i, j) * (1 + slope * slopeCost);
      if (next >= known(j)) continue;
      s.stamp[j] = s.search;
      s.cost[j] = next;
      s.previous[j] = i;
      front.push(j, next + distance(g, j, end));
    }
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
