import {
  gridPosition,
  neighbors,
  requireThat,
  spatial,
  type Grid,
  type Position,
} from "@atlas/domain";

interface Step {
  cell: number;
  cost: number;
}
export class RouteHeap {
  private readonly items: Step[] = [];
  push(item: Step) {
    const items = this.items;
    let index = items.length;
    items.push(item);
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (items[parent].cost <= item.cost) break;
      items[index] = items[parent];
      index = parent;
    }
    items[index] = item;
  }
  pop() {
    const items = this.items,
      first = items[0],
      last = items.pop();
    if (!items.length || !last) return first;
    let index = 0;
    while (index * 2 + 1 < items.length) {
      let child = index * 2 + 1;
      if (child + 1 < items.length && items[child + 1].cost < items[child].cost) child++;
      if (items[child].cost >= last.cost) break;
      items[index] = items[child];
      index = child;
    }
    items[index] = last;
    return first;
  }
}
function nearest(grid: Grid, point: Position) {
  requireThat(
    spatial.covers(grid.scope.footprint, { type: "Point", coordinates: [point.x, point.y] }),
    "route_extent",
    "Route waypoints must lie inside the sampled geography."
  );
  let best = -1,
    distance = Infinity;
  for (let i = 0; i < grid.active.length; i++) {
    if (!grid.active[i]) continue;
    const p = gridPosition(grid, i),
      candidate = Math.hypot(p.x - point.x, p.y - point.y);
    if (candidate < distance) {
      best = i;
      distance = candidate;
    }
  }
  requireThat(best >= 0, "route_samples", "This extent has no active routing samples.");
  return best;
}
export function findRoute(grid: Grid, from: Position, to: Position, kind: string): Position[] {
  const start = nearest(grid, from),
    end = nearest(grid, to);
  // Every edge uses the same footprint. Read its topology once per route
  // while retaining exact segment checks at concavities and holes.
  const covers = spatial.geometryCoverage(grid.scope.footprint);
  const costs = new Float64Array(grid.active.length).fill(Infinity);
  const previous = new Int32Array(grid.active.length).fill(-1),
    queue = new RouteHeap();
  // A*: no step costs less than its distance times the cheapest land factor, so the straight
  // distance to the end, so scaled, never overestimates and the search stays near the way.
  const goal = gridPosition(grid, end),
    cheapest = kind === "road" ? riverBankFactor : 1;
  const remaining = (cell: number) => {
    const p = gridPosition(grid, cell);
    return Math.hypot(p.x - goal.x, p.y - goal.y) * cheapest;
  };
  costs[start] = 0;
  queue.push({ cell: start, cost: remaining(start) });
  for (let entry = queue.pop(); entry; entry = queue.pop()) {
    const here = costs[entry.cell];
    if (entry.cost !== here + remaining(entry.cell)) continue;
    if (entry.cell === end) return routePoints(grid, previous, start, end, from, to);
    for (const next of neighbors(grid, entry.cell, true, covers)) {
      const step = routeCost(grid, entry.cell, next, kind);
      const cost = here + step;
      if (cost >= costs[next]) continue;
      costs[next] = cost;
      previous[next] = entry.cell;
      queue.push({ cell: next, cost: cost + remaining(next) });
    }
  }
  return [];
}
function routeCost(grid: Grid, from: number, to: number, kind: string) {
  const a = gridPosition(grid, from),
    b = gridPosition(grid, to),
    distance = Math.hypot(a.x - b.x, a.y - b.y);
  if (kind === "river") return riverCost(grid, from, to, distance);
  if (kind === "sea") return distance * seaFactor(grid, to);
  if (kind === "road" && oceanCell(grid, to)) return Infinity;
  const rise = grid.channels.elevation[to] - grid.channels.elevation[from];
  const slope = 1 + (Math.abs(rise) / Math.max(1, distance)) * 20;
  return distance * slope * (kind === "road" ? landFactor(grid, from, to) : 1);
}
/** A river runs downhill only, and the more water it carries the easier it is to follow. */
function riverCost(grid: Grid, from: number, to: number, distance: number) {
  const heights = grid.channels.drainageElevation ?? grid.channels.elevation;
  if (heights[to] - heights[from] > 1e-6) return Infinity;
  return distance * (1 + 1 / (1 + (grid.channels.flow?.[to] ?? 0)));
}
/**
 * A pre-modern lane hugs the coast: shallow water beside the shore costs its distance, deep
 * open water up to twice that. A land cell costs four times, so a lane reaches its harbour
 * over the shore cell and no further.
 */
function seaFactor(grid: Grid, to: number) {
  if (!oceanCell(grid, to)) return 4;
  const depth = Math.max(0, -grid.channels.elevation[to]);
  return 1 + Math.min(1, depth / 1000);
}
/** A road along a river bank costs this share of open ground: the valley floor is the way. */
const riverBankFactor = 0.7;
/**
 * What the land between two cells asks of a road beyond its slope: forest and marsh slow it,
 * a river bank speeds it, and a crossing pays for its ford or bridge. Saddles need no term of
 * their own; the slope term finds them.
 */
function landFactor(grid: Grid, from: number, to: number) {
  const river = (i: number) => (grid.channels.riverOrder?.[i] ?? 0) >= 1;
  if (river(from) && river(to)) return Math.min(groundFactor(grid, to), riverBankFactor);
  return groundFactor(grid, to) + (river(from) !== river(to) ? crossingCharge : 0);
}
/** Open ground is one; forest and flat sodden ground ask more of a road. */
function groundFactor(grid: Grid, to: number) {
  const c = grid.channels;
  const trees = c.treeCover?.[to] ?? 0,
    sodden = (c.moisture?.[to] ?? 0) >= 0.95 && (c.slope?.[to] ?? 1) < 0.01;
  return 1 + 0.8 * trees + (sodden ? 0.6 : 0);
}
/** A river crossing, as extra lengths of the step that crosses it. */
const crossingCharge = 0.6;
function oceanCell(grid: Grid, index: number) {
  return grid.channels.water?.[index] === 1 || grid.channels.elevation[index] < 0;
}
function routePoints(
  grid: Grid,
  previous: Int32Array,
  start: number,
  end: number,
  from: Position,
  to: Position
) {
  const cells = [end];
  while (cells.at(-1) !== start) cells.push(previous[cells.at(-1)!]);
  const path = cells.reverse().map((i) => gridPosition(grid, i));
  path[0] = from;
  path[path.length - 1] = to;
  return path.length > 1 ? path : [from, to];
}
