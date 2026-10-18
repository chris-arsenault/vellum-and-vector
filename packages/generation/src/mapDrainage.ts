import { putChannel, requireThat, type Grid } from "@atlas/domain";
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
  links: number[][];
  receiver: Float64Array;
  height: Float64Array;
  rank: Float64Array;
  basin: Float64Array;
  ocean: Uint8Array;
  order: number[];
}

// Priority flood retains the physical floor and supplies a spill elevation plus
// a strictly ranked parent tree. Flats drain along that tree without cycles or
// manufacturing tiny downhill cuts in the authoritative terrain.
export function conditionDrainage(
  grid: Grid,
  seaLevel: number,
  context: MapProcessContext
): Drainage {
  const floor = requireChannel(grid, "elevation", "metre"),
    links = adjacency(grid);
  const receiver = new Float64Array(floor.length).fill(-1),
    height = floor.slice();
  const rank = new Float64Array(floor.length).fill(-1),
    basin = new Float64Array(floor.length);
  const seen = new Uint8Array(floor.length),
    heap = new CellHeap(height),
    order: number[] = [];
  const ocean = connectedOcean(grid, links, floor, seaLevel);
  for (let i = 0; i < floor.length; i++) {
    if (!grid.active[i] || !boundaryCell(grid, i)) continue;
    height[i] = Math.max(floor[i], ocean[i] ? seaLevel : floor[i]);
    seen[i] = 1;
    basin[i] = i + 1;
    heap.push(i);
  }
  for (let i = heap.pop(); i !== undefined; i = heap.pop()) {
    checkProgress(
      context,
      order.length,
      floor.length,
      "Resolving depressions and drainage outlets"
    );
    rank[i] = order.length;
    order.push(i);
    for (const j of links[i]) {
      if (seen[j]) continue;
      seen[j] = 1;
      receiver[j] = i;
      height[j] = Math.max(floor[j], height[i]);
      basin[j] = basin[i];
      heap.push(j);
    }
  }
  requireThat(
    order.length === grid.active.reduce((sum, v) => sum + v, 0),
    "drainage_component",
    "Every active component needs a mapped boundary outlet."
  );
  return { links, receiver, height, rank, basin, ocean, order };
}

function connectedOcean(grid: Grid, links: number[][], floor: Float64Array, seaLevel: number) {
  const ocean = new Uint8Array(floor.length),
    queue: number[] = [];
  for (let i = 0; i < floor.length; i++)
    if (grid.active[i] && boundaryCell(grid, i) && floor[i] < seaLevel) {
      ocean[i] = 1;
      queue.push(i);
    }
  for (let n = 0; n < queue.length; n++)
    for (const j of links[queue[n]])
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
  const runoff = new Float64Array(rainfall.length),
    flow = new Float64Array(rainfall.length),
    outlet = new Float64Array(rainfall.length);
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

function accumulateFlow(graph: Drainage, flow: Float64Array, outlet: Float64Array) {
  for (const i of [...graph.order].reverse()) {
    const target = graph.receiver[i];
    if (target >= 0) flow[target] += flow[i];
    else outlet[i] = flow[i];
  }
}

export function writeDrainage(grid: Grid, graph: Drainage, seaLevel: number) {
  const floor = grid.channels.elevation,
    depth = new Float64Array(floor.length),
    depression = new Float64Array(floor.length),
    water = new Float64Array(floor.length);
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
