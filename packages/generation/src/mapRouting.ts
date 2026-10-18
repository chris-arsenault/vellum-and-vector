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
class RouteHeap {
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
  costs[start] = 0;
  queue.push({ cell: start, cost: 0 });
  for (let entry = queue.pop(); entry; entry = queue.pop()) {
    if (entry.cost !== costs[entry.cell]) continue;
    if (entry.cell === end) return routePoints(grid, previous, start, end, from, to);
    for (const next of neighbors(grid, entry.cell, true, covers)) {
      const step = routeCost(grid, entry.cell, next, kind);
      const cost = entry.cost + step;
      if (cost >= costs[next]) continue;
      costs[next] = cost;
      previous[next] = entry.cell;
      queue.push({ cell: next, cost });
    }
  }
  return [];
}
function routeCost(grid: Grid, from: number, to: number, kind: string) {
  const heights =
    kind === "river"
      ? (grid.channels.drainageElevation ?? grid.channels.elevation)
      : grid.channels.elevation;
  const a = gridPosition(grid, from),
    b = gridPosition(grid, to),
    distance = Math.hypot(a.x - b.x, a.y - b.y);
  const rise = heights[to] - heights[from];
  if (kind === "river")
    return rise > 1e-6 ? Infinity : distance * (1 + 1 / (1 + (grid.channels.flow?.[to] ?? 0)));
  if (kind === "road" && oceanCell(grid, to)) return Infinity;
  return distance * (1 + (Math.abs(rise) / Math.max(1, distance)) * 20);
}
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
