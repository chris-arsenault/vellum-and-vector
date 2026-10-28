import {
  gridPosition,
  gridDistance,
  neighbors,
  requireThat,
  spatial,
  allocateNumerical,
  KeyedHeap,
  type Grid,
  type Position,
  type NumericalAllocator,
  type NumericalVector,
} from "@atlas/domain";

/** Cheapest-first cell frontier; `pop()` returns the cell or -1 and `cost()` its key. */
export class RouteHeap {
  private readonly items = new KeyedHeap("min");
  push(cell: number, cost: number) {
    this.items.push(cell, cost);
  }
  pop() {
    return this.items.pop();
  }
  cost() {
    return this.items.poppedKey();
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
      candidate = gridDistance(grid, p, point);
    if (candidate < distance) {
      best = i;
      distance = candidate;
    }
  }
  requireThat(best >= 0, "route_samples", "This extent has no active routing samples.");
  return best;
}
export function findRoute(
  grid: Grid,
  from: Position,
  to: Position,
  kind: string,
  numerical?: NumericalAllocator
): Position[] {
  const allocate = (type: "float64" | "int32", name: string) =>
    allocateNumerical(
      {
        type,
        length: grid.active.length,
        lifetime: "process",
        name,
      },
      numerical
    );
  const costs = allocate("float64", "route-cost").fill(Infinity),
    previous = allocate("int32", "route-previous").fill(-1),
    queue = new RouteHeap();
  try {
    return searchRoute(grid, from, to, kind, { costs, previous, queue });
  } finally {
    numerical?.releaseUnused([costs, previous], []);
  }
}
function searchRoute(
  grid: Grid,
  from: Position,
  to: Position,
  kind: string,
  {
    costs,
    previous,
    queue,
  }: { costs: NumericalVector; previous: NumericalVector; queue: RouteHeap }
) {
  const start = nearest(grid, from),
    end = nearest(grid, to);
  // Every edge uses the same footprint. Read its topology once per route
  // while retaining exact segment checks at concavities and holes.
  const covers = spatial.geometryCoverage(grid.scope.footprint);
  // A*: no step costs less than its distance times the cheapest land factor, so the straight
  // distance to the end, so scaled, never overestimates and the search stays near the way.
  const goal = gridPosition(grid, end),
    cheapest = kind === "road" ? riverBankFactor : 1;
  const remaining = (cell: number) => {
    const p = gridPosition(grid, cell);
    return gridDistance(grid, p, goal) * cheapest;
  };
  costs[start] = 0;
  queue.push(start, remaining(start));
  for (let cell = queue.pop(); cell >= 0; cell = queue.pop()) {
    const here = costs[cell];
    if (queue.cost() !== here + remaining(cell)) continue;
    if (cell === end) return routePoints(grid, previous, start, end, from, to);
    for (const next of neighbors(grid, cell, true, covers)) {
      const step = routeCost(grid, cell, next, kind);
      const cost = here + step;
      if (cost >= costs[next]) continue;
      costs[next] = cost;
      previous[next] = cell;
      queue.push(next, cost + remaining(next));
    }
  }
  return [];
}
function routeCost(grid: Grid, from: number, to: number, kind: string) {
  const a = gridPosition(grid, from),
    b = gridPosition(grid, to),
    distance = gridDistance(grid, a, b);
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
  previous: NumericalVector,
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
