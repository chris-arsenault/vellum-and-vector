import { gridDistance, gridPosition, neighbors, spatial, type Band } from "@atlas/domain";
import type { GenerationState } from "./process";
import { RouteHeap } from "./mapRouting";
import { dryLand } from "./societySupport";

export interface SocietyEdge {
  a: number;
  b: number;
  cost: number;
  distance: number;
  kind?: "river" | "sea" | "door";
}
const riverTravel = 0.5;
const seaTravel = 0.5;
const seaLaunch = 10000;

/** The numerical topology already owns adjacency; travel reads its local edges on demand. */
function localEdges(state: GenerationState, marine: boolean) {
  const grid = state.surface,
    covers = spatial.geometryCoverage(grid.scope.footprint);
  const sea = (i: number) => Boolean(grid.active.get(i)) && grid.channels.water?.get(i) === 1;
  return function* (i: number): Iterable<SocietyEdge> {
    if (marine ? !sea(i) : !dryLand(state, i)) return;
    const a = gridPosition(grid, i);
    for (const j of neighbors(grid, i, false, covers)) {
      const distance = gridDistance(grid, a, gridPosition(grid, j));
      if (marine) {
        if (!sea(j) && !dryLand(state, j)) continue;
        yield sea(j)
          ? { a: i, b: j, distance, cost: distance * seaTravel, kind: "sea" }
          : { a: j, b: i, distance, cost: distance * seaTravel + seaLaunch, kind: "sea" };
      } else {
        const edge = landEdge(state, i, j, distance);
        if (edge) yield edge;
      }
    }
  };
}
function landEdge(
  state: GenerationState,
  a: number,
  b: number,
  distance: number
): SocietyEdge | null {
  if (!dryLand(state, b)) return null;
  const grid = state.surface,
    riverOrder = grid.channels.riverOrder,
    river = riverOrder !== undefined && riverOrder.get(a) >= 1 && riverOrder.get(b) >= 1,
    rise = Math.abs(grid.channels.elevation.get(b) - grid.channels.elevation.get(a));
  if (!river && rise / Math.max(1, distance) > 0.6) return null;
  return {
    a,
    b,
    distance,
    cost: river ? distance * riverTravel : distance + 30 * rise,
    ...(river ? { kind: "river" as const } : {}),
  };
}
export function* landEdges(state: GenerationState) {
  const read = localEdges(state, false);
  for (let i = 0; i < state.surface.active.length; i++)
    for (const edge of read(i)) if (edge.b > edge.a) yield edge;
}
export function* seaEdges(state: GenerationState) {
  const read = localEdges(state, true);
  for (let i = 0; i < state.surface.active.length; i++)
    for (const edge of read(i)) if (edge.b > edge.a || edge.a !== i) yield edge;
}
/** Connected multi-source ownership, with the frontier and labels in the working arena. */
export class SocietySpread {
  readonly owner: Band;
  readonly distances: Band;
  private queue: RouteHeap;
  private edges: ReturnType<typeof localEdges>;
  constructor(
    state: GenerationState,
    private marine = false
  ) {
    const allocate = (type: "int32" | "float64", name: string) =>
      state.surface.coverage.scratch(type, name, state.surface.active.length);
    this.owner = allocate("int32", "society-owner").fill(-1);
    this.distances = allocate("float64", "society-distance").fill(Infinity);
    this.queue = new RouteHeap();
    this.edges = localEdges(state, marine);
  }
  seed(cell: number, owner: number, cost = 0) {
    if (cost >= this.distances.get(cell)) return;
    this.owner.set(cell, owner);
    this.distances.set(cell, cost);
    this.queue.push(cell, cost);
  }
  run() {
    for (let cell = this.queue.pop(); cell >= 0; cell = this.queue.pop()) {
      const here = this.queue.cost();
      if (here !== this.distances.get(cell)) continue;
      for (const edge of this.edges(cell)) {
        if (this.marine && edge.a !== cell) continue;
        const next = edge.b,
          cost = here + edge.cost;
        if (cost >= this.distances.get(next)) continue;
        this.owner.set(next, this.owner.get(cell));
        this.distances.set(next, cost);
        this.queue.push(next, cost);
      }
    }
  }
}
