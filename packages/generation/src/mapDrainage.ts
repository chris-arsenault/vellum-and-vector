import {
  allocateNumerical,
  CellQueue,
  putChannel,
  requireThat,
  type Grid,
  type NumericalVector,
  type NumericalAllocator,
} from "@atlas/domain";
import { requireChannel } from "./mapFields";
import {
  adjacency,
  boundaryCell,
  CellHeap,
  checkProgress,
  epochYears,
  secondsPerYear,
} from "./mapLattice";
import type { GenerationState, MapProcessContext } from "./process";

export interface Drainage {
  links: (cell: number) => number[];
  receiver: NumericalVector;
  height: NumericalVector;
  rank: NumericalVector;
  basin: NumericalVector;
  ocean: NumericalVector;
  order: NumericalVector;
}

// Priority flood retains the physical floor and supplies a spill elevation plus
// a strictly ranked parent tree. Flats drain along that tree without cycles or
// manufacturing tiny downhill cuts in the authoritative terrain.
export function conditionDrainage(
  grid: Grid,
  seaLevel: number,
  context: MapProcessContext,
  numerical?: NumericalAllocator
): Drainage {
  const floor = requireChannel(grid, "elevation", "metre"),
    links = adjacency(grid);
  const vector = (type: "float64" | "uint8" | "int32", name: string) =>
    allocateNumerical(
      { type, length: floor.length, lifetime: "process", name: `drainage:${name}` },
      numerical
    );
  const receiver = vector("float64", "receiver").fill(-1),
    height = floor.slice();
  const rank = vector("float64", "rank").fill(-1),
    basin = vector("float64", "basin");
  const seen = vector("uint8", "seen"),
    heap = new CellHeap(height),
    order = vector("int32", "order");
  let count = 0;
  const ocean = connectedOcean(grid, links, floor, seaLevel, numerical);
  for (let i = 0; i < floor.length; i++) {
    if (!grid.active[i] || !boundaryCell(grid, i)) continue;
    height[i] = Math.max(floor[i], ocean[i] ? seaLevel : floor[i]);
    seen[i] = 1;
    basin[i] = i + 1;
    heap.push(i);
  }
  for (let i = heap.pop(); i >= 0; i = heap.pop()) {
    checkProgress(context, count, floor.length, "Resolving depressions and drainage outlets");
    rank[i] = count;
    order[count++] = i;
    for (const j of links(i)) {
      if (seen[j]) continue;
      seen[j] = 1;
      receiver[j] = i;
      height[j] = Math.max(floor[j], height[i]);
      basin[j] = basin[i];
      heap.push(j);
    }
  }
  requireThat(
    count === grid.active.reduce((sum, v) => sum + v, 0),
    "drainage_component",
    "Every active component needs a mapped boundary outlet."
  );
  numerical?.release(seen);
  return { links, receiver, height, rank, basin, ocean, order: order.subarray(0, count) };
}

function connectedOcean(
  grid: Grid,
  links: Drainage["links"],
  floor: NumericalVector,
  seaLevel: number,
  numerical?: NumericalAllocator
) {
  const ocean = allocateNumerical(
      { type: "uint8", length: floor.length, lifetime: "process", name: "drainage:ocean" },
      numerical
    ),
    queue = new CellQueue();
  for (let i = 0; i < floor.length; i++)
    if (grid.active[i] && boundaryCell(grid, i) && floor[i] < seaLevel) {
      ocean[i] = 1;
      queue.push(i);
    }
  for (let i = queue.shift(); i >= 0; i = queue.shift())
    for (const j of links(i))
      if (!ocean[j] && floor[j] < seaLevel) {
        ocean[j] = 1;
        queue.push(j);
      }
  return ocean;
}

export function routeRunoff(state: GenerationState, graph: Drainage, context: MapProcessContext) {
  const grid = state.surface,
    rainfall = requireChannel(grid, "rainfall", "metre/year");
  const melt = state.facts.has("meltwater") ? requireChannel(grid, "meltwater", "metre") : null;
  const years = epochYears(context, Number(context.parameters.meltwaterYears));
  const values = (name: string) =>
    allocateNumerical(
      { type: "float64", length: rainfall.length, lifetime: "process", name: `runoff:${name}` },
      state.numerical
    );
  const runoff = values("runoff"),
    flow = values("flow"),
    outlet = values("outlet");
  for (const i of graph.order) {
    const available = Math.max(0, rainfall[i]) + (years > 0 ? (melt?.[i] ?? 0) / years : 0);
    runoff[i] = graph.ocean[i]
      ? 0
      : Math.max(0, available - Number(context.parameters.evaporation)) *
        Number(context.parameters.runoffFraction);
    flow[i] = (runoff[i] * grid.measures[i]) / secondsPerYear;
  }
  const supplied = flow.reduce((sum, v) => sum + v, 0);
  accumulateFlow(graph, flow, outlet);
  const outflow = outlet.reduce((sum, v) => sum + v, 0);
  requireThat(
    Math.abs(outflow - supplied) <= Math.max(1e-10, supplied * 1e-10),
    "runoff_balance",
    "Routed runoff must equal the sum of mapped outlet discharge."
  );
  for (const [key, values] of Object.entries({ runoff, flow, outletFlow: outlet }))
    putChannel(grid, key, key === "runoff" ? "metre/year" : "cubic-metre/second", values);
  context.recordCause({
    kind: "drainage",
    process: "hydrology.drainage",
    runoff: supplied,
    outflow,
    unit: "cubic-metre/second",
  });
}

function accumulateFlow(graph: Drainage, flow: NumericalVector, outlet: NumericalVector) {
  for (let n = graph.order.length - 1; n >= 0; n--) {
    const i = graph.order[n];
    const target = graph.receiver[i];
    if (target >= 0) flow[target] += flow[i];
    else outlet[i] = flow[i];
  }
}

export function writeDrainage(
  grid: Grid,
  graph: Drainage,
  seaLevel: number,
  numerical?: NumericalAllocator
) {
  const values = (name: string) =>
    allocateNumerical(
      {
        type: "float64",
        length: grid.active.length,
        lifetime: "process",
        name: `drainage:${name}`,
      },
      numerical
    );
  const floor = grid.channels.elevation,
    depth = values("depth"),
    depression = values("depression"),
    water = values("water");
  for (const i of graph.order) {
    depression[i] = Math.max(0, graph.height[i] - floor[i]);
    depth[i] = graph.ocean[i]
      ? Math.max(0, seaLevel - floor[i])
      : grid.channels.flow[i] > 0
        ? depression[i]
        : 0;
    water[i] = graph.ocean[i] ? 1 : depth[i] > 1e-8 ? 2 : 0;
  }
  for (const [key, values] of Object.entries({
    receiver: graph.receiver,
    drainageRank: graph.rank,
    drainageElevation: graph.height,
    basin: graph.basin,
    waterDepth: depth,
    depressionDepth: depression,
    water,
  }))
    putChannel(grid, key, drainageUnit(key), values);
}
function drainageUnit(key: string) {
  if (["receiver", "drainageRank"].includes(key)) return "cell-index";
  return ["basin", "water"].includes(key) ? "category" : "metre";
}
