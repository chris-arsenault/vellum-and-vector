import { riverLayer } from "./water/riverKeeping";
import {
  gridPosition,
  gridDistance,
  fieldPosition,
  fieldChartFootprint,
  neighbors,
  requireThat,
  requireChannel,
  spatial,
  CellList,
  KeyedHeap,
  MapScale,
  type Band,
  type Grid,
  type Position,
  type SpatialIndex,
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
function nearest(grid: Grid, point: Position, index: SpatialIndex, cells: Int32Array) {
  point = fieldPosition(grid, point);
  requireThat(
    spatial.covers(fieldChartFootprint(grid), { type: "Point", coordinates: [point.x, point.y] }),
    "route_extent",
    "Route waypoints must lie inside the sampled geography."
  );
  let best = -1,
    distance = Infinity;
  const located = fieldPosition(grid, point),
    shifts = grid.periodicWidth ? [0, -grid.periodicWidth, grid.periodicWidth] : [0];
  for (const shift of shifts) {
    const found = index.nearest({ ...located, x: located.x + shift });
    if (found < 0) continue;
    const i = cells[found],
      p = gridPosition(grid, i),
      candidate = gridDistance(grid, p, point);
    if (candidate < distance) {
      best = i;
      distance = candidate;
    }
  }
  requireThat(best >= 0, "route_samples", "This extent has no active routing samples.");
  return best;
}
export type RouteFinder = (from: Position, to: Position, kind: string) => Position[];
/** Cache only GEOS-checked adjacency; each cell's first query uses the shared neighbor contract. */
function routeNeighbors(grid: Grid) {
  const cells = new CellList(),
    offsets = new Int32Array(grid.active.length).fill(-1),
    counts = new Int32Array(grid.active.length),
    covers = spatial.geometryCoverage(fieldChartFootprint(grid));
  return {
    cells,
    counts,
    offset(cell: number) {
      if (offsets[cell] < 0) {
        const adjacent = neighbors(grid, cell, true, covers);
        offsets[cell] = cells.length;
        counts[cell] = adjacent.length;
        for (const next of adjacent) cells.push(next);
      }
      return offsets[cell];
    },
  };
}
/**
 * Topology, active samples and footprint stay fixed throughout this synchronous batch.
 * Its sample index and checked adjacency are scoped; terrain costs remain live for each route.
 */
export function withRouteFinder<T>(grid: Grid, work: (find: RouteFinder) => T): T {
  const cells = Int32Array.from({ length: grid.active.length }, (_, i) => i).filter((i) =>
    Boolean(grid.active.get(i))
  );
  const points = Array.from(cells, (i) => {
    const p = gridPosition(grid, i);
    return { type: "Point" as const, coordinates: [p.x, p.y] };
  });
  return spatial.withIndex(points, (index) => {
    const adjacent = routeNeighbors(grid);
    let active = true;
    try {
      return work((from, to, kind) => {
        requireThat(active, "route_lifetime", "The routing scope has ended.");
        const locate = (point: Position) => nearest(grid, point, index, cells);
        return routeBetween(grid, from, to, kind, locate, adjacent);
      });
    } finally {
      active = false;
    }
  });
}
export function findRoute(grid: Grid, from: Position, to: Position, kind: string): Position[] {
  return withRouteFinder(grid, (find) => find(from, to, kind));
}
function routeBetween(
  grid: Grid,
  from: Position,
  to: Position,
  kind: string,
  locate: (point: Position) => number,
  adjacent: ReturnType<typeof routeNeighbors>
): Position[] {
  const allocate = (type: "float64" | "int32", name: string) =>
    grid.coverage.scratch(type, name, grid.active.length);
  const costs = allocate("float64", "route-cost").fill(Infinity),
    previous = allocate("int32", "route-previous").fill(-1),
    queue = new RouteHeap();
  try {
    return searchRoute(grid, from, to, kind, { costs, previous, queue }, locate, adjacent);
  } finally {
    grid.coverage.releaseUnused([costs, previous], []);
  }
}
function searchRoute(
  grid: Grid,
  from: Position,
  to: Position,
  kind: string,
  { costs, previous, queue }: { costs: Band; previous: Band; queue: RouteHeap },
  locate: (point: Position) => number,
  adjacent: ReturnType<typeof routeNeighbors>
) {
  const start = locate(from),
    end = locate(to),
    scale = MapScale.fromCells(grid.bounds, grid.active.length),
    terrain = routeTerrain(grid);
  // A*: no step costs less than its distance times the cheapest land factor, so the straight
  // distance to the end, so scaled, never overestimates and the search stays near the way.
  const goal = gridPosition(grid, end),
    cheapest = kind === "road" ? riverBankFactor : 1;
  const remaining = (cell: number) => {
    const p = gridPosition(grid, cell);
    return gridDistance(grid, p, goal) * cheapest;
  };
  costs.set(start, 0);
  queue.push(start, remaining(start));
  for (let cell = queue.pop(); cell >= 0; cell = queue.pop()) {
    const here = costs.get(cell);
    if (queue.cost() !== here + remaining(cell)) continue;
    if (cell === end) return routePoints(grid, previous, start, end, from, to);
    for (let at = adjacent.offset(cell), end = at + adjacent.counts[cell]; at < end; at++) {
      const next = adjacent.cells.at(at);
      const step = routeCost(grid, terrain, cell, next, kind, scale);
      const cost = here + step;
      if (cost >= costs.get(next)) continue;
      costs.set(next, cost);
      previous.set(next, cell);
      queue.push(next, cost + remaining(next));
    }
  }
  return [];
}
function routeTerrain(grid: Grid) {
  const elevation = requireChannel(grid, "Elevation");
  return {
    elevation,
    drainage: grid.channels.DrainageElevations ?? elevation,
    sea: grid.channels.EffectiveSeaLevel,
    water: grid.channels.WaterKindCodes,
    flow: grid.channels.FlowAccumulation,
    river: grid.channels[riverLayer],
    trees: grid.channels.TreeCover,
    moisture: grid.channels.Moisture,
    slope: grid.channels.Slope,
  };
}
type RouteTerrain = ReturnType<typeof routeTerrain>;
function routeCost(
  grid: Grid,
  terrain: RouteTerrain,
  from: number,
  to: number,
  kind: string,
  scale: MapScale
) {
  const a = gridPosition(grid, from),
    b = gridPosition(grid, to),
    distance = gridDistance(grid, a, b);
  if (kind === "river") return riverCost(terrain, from, to, distance, scale);
  if (kind === "sea") return distance * seaFactor(terrain, to, scale);
  if (kind === "road" && oceanCell(terrain, to)) return Infinity;
  const rise = MapScale.metres(terrain.elevation.get(to) - terrain.elevation.get(from), "native");
  const slope = 1 + (Math.abs(rise) / Math.max(scale.length(2.5e-7), distance)) * 20;
  return distance * slope * (kind === "road" ? landFactor(terrain, from, to) : 1);
}
/** A river runs downhill only, and the more water it carries the easier it is to follow. */
function riverCost(
  terrain: RouteTerrain,
  from: number,
  to: number,
  distance: number,
  scale: MapScale
) {
  const heights = terrain.drainage;
  if (MapScale.metres(heights.get(to) - heights.get(from), "native") > scale.length(2.5e-13))
    return Infinity;
  return distance * (1 + 1 / (1 + (terrain.flow?.get(to) ?? 0) / scale.volume(1.5625e-20)));
}
/**
 * A pre-modern lane hugs the coast: shallow water beside the shore costs its distance, deep
 * open water up to twice that. A land cell costs four times, so a lane reaches its harbour
 * over the shore cell and no further.
 */
export const landCellSeaCost = 4;
function seaFactor(terrain: RouteTerrain, to: number, scale: MapScale) {
  if (!oceanCell(terrain, to)) return landCellSeaCost;
  const depth = Math.max(
    0,
    MapScale.metres((terrain.sea?.get(to) ?? 0) - terrain.elevation.get(to), "native")
  );
  return 1 + Math.min(1, depth / scale.length(0.00025));
}
/** A road along a river bank costs this share of open ground: the valley floor is the way. */
const riverBankFactor = 0.7;
/**
 * What the land between two cells asks of a road beyond its slope: forest and marsh slow it,
 * a river bank speeds it, and a crossing pays for its ford or bridge. Saddles need no term of
 * their own; the slope term finds them.
 */
function landFactor(terrain: RouteTerrain, from: number, to: number) {
  const river = (i: number) => (terrain.river?.get(i) ?? 0) >= 1;
  if (river(from) && river(to)) return Math.min(groundFactor(terrain, to), riverBankFactor);
  return groundFactor(terrain, to) + (river(from) !== river(to) ? crossingCharge : 0);
}
/** Open ground is one; forest and flat sodden ground ask more of a road. */
function groundFactor(terrain: RouteTerrain, to: number) {
  const trees = terrain.trees?.get(to) ?? 0,
    sodden = (terrain.moisture?.get(to) ?? 0) >= 950 && (terrain.slope?.get(to) ?? 1) < 0.01;
  return 1 + 0.8 * trees + (sodden ? 0.6 : 0);
}
/** A river crossing, as extra lengths of the step that crosses it. */
const crossingCharge = 0.6;
function oceanCell(terrain: RouteTerrain, index: number) {
  return terrain.water
    ? terrain.water.get(index) === 1
    : terrain.elevation.get(index) < (terrain.sea?.get(index) ?? 0);
}
function routePoints(
  grid: Grid,
  previous: Band,
  start: number,
  end: number,
  from: Position,
  to: Position
) {
  const cells = [end];
  while (cells.at(-1) !== start) cells.push(previous.get(cells.at(-1)!));
  const path = cells.reverse().map((i) => gridPosition(grid, i));
  path[0] = from;
  path[path.length - 1] = to;
  return path.length > 1 ? path : [from, to];
}
