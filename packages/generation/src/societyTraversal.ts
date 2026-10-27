import {
  allocateNumerical,
  gridDistance,
  gridPosition,
  neighbors,
  spatial,
  type NumericalVector,
} from "@atlas/domain";
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
  const sea = (i: number) => Boolean(grid.active[i]) && grid.channels.water?.[i] === 1;
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
    river = grid.channels.riverOrder?.[a] >= 1 && grid.channels.riverOrder?.[b] >= 1,
    rise = Math.abs(grid.channels.elevation[b] - grid.channels.elevation[a]);
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
  readonly owner: NumericalVector;
  readonly distances: NumericalVector;
  private queue: RouteHeap;
  private edges: ReturnType<typeof localEdges>;
  constructor(
    state: GenerationState,
    private marine = false
  ) {
    const allocate = (type: "int32" | "float64", name: string) =>
      allocateNumerical(
        {
          type,
          length: state.surface.active.length,
          lifetime: "process",
          name,
        },
        state.numerical
      );
    this.owner = allocate("int32", "society-owner").fill(-1);
    this.distances = allocate("float64", "society-distance").fill(Infinity);
    this.queue = new RouteHeap(state.numerical);
    this.edges = localEdges(state, marine);
  }
  seed(cell: number, owner: number, cost = 0) {
    if (cost >= this.distances[cell]) return;
    this.owner[cell] = owner;
    this.distances[cell] = cost;
    this.queue.push({ cell, cost });
  }
  run() {
    for (let entry = this.queue.pop(); entry; entry = this.queue.pop()) {
      if (entry.cost !== this.distances[entry.cell]) continue;
      for (const edge of this.edges(entry.cell)) {
        if (this.marine && edge.a !== entry.cell) continue;
        const next = edge.b,
          cost = entry.cost + edge.cost;
        if (cost >= this.distances[next]) continue;
        this.owner[next] = this.owner[entry.cell];
        this.distances[next] = cost;
        this.queue.push({ cell: next, cost });
      }
    }
  }
  close() {
    this.queue.close();
  }
}
