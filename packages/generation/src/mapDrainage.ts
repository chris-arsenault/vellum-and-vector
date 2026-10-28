import {
  CellQueue,
  foldSamples,
  putChannel,
  requireThat,
  type Band,
  type Grid,
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
  receiver: Band;
  height: Band;
  rank: Band;
  basin: Band;
  ocean: Band;
  /** Active cells from outlet to source; its length is the active cell count. */
  order: Band;
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
    links = adjacency(grid),
    coverage = grid.coverage,
    activeCount = foldSamples(grid.active, (sum, v) => sum + v, 0);
  const vector = (type: "float64" | "uint8" | "int32", name: string, length = floor.length) =>
    coverage.scratch(type, `drainage:${name}`, length);
  const receiver = vector("float64", "receiver").fill(-1),
    height = coverage.copyBand(floor);
  const rank = vector("float64", "rank").fill(-1),
    basin = vector("float64", "basin");
  const seen = vector("uint8", "seen"),
    heap = new CellHeap(height),
    order = vector("int32", "order", activeCount);
  let count = 0;
  const ocean = connectedOcean(grid, links, floor, seaLevel);
  for (let i = 0; i < floor.length; i++) {
    if (!grid.active.get(i) || !boundaryCell(grid, i)) continue;
    height.set(i, Math.max(floor.get(i), ocean.get(i) ? seaLevel : floor.get(i)));
    seen.set(i, 1);
    basin.set(i, i + 1);
    heap.push(i);
  }
  for (let i = heap.pop(); i >= 0; i = heap.pop()) {
    checkProgress(context, count, floor.length, "Resolving depressions and drainage outlets");
    rank.set(i, count);
    order.set(count++, i);
    for (const j of links(i)) {
      if (seen.get(j)) continue;
      seen.set(j, 1);
      receiver.set(j, i);
      height.set(j, Math.max(floor.get(j), height.get(i)));
      basin.set(j, basin.get(i));
      heap.push(j);
    }
  }
  requireThat(
    count === activeCount,
    "drainage_component",
    "Every active component needs a mapped boundary outlet."
  );
  coverage.release(seen);
  return { links, receiver, height, rank, basin, ocean, order };
}

function connectedOcean(grid: Grid, links: Drainage["links"], floor: Band, seaLevel: number) {
  const ocean = grid.coverage.scratch("uint8", "drainage:ocean", floor.length),
    queue = new CellQueue();
  for (let i = 0; i < floor.length; i++)
    if (grid.active.get(i) && boundaryCell(grid, i) && floor.get(i) < seaLevel) {
      ocean.set(i, 1);
      queue.push(i);
    }
  for (let i = queue.shift(); i >= 0; i = queue.shift())
    for (const j of links(i))
      if (!ocean.get(j) && floor.get(j) < seaLevel) {
        ocean.set(j, 1);
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
    grid.coverage.scratch("float64", `runoff:${name}`, rainfall.length);
  const runoff = values("runoff"),
    flow = values("flow"),
    outlet = values("outlet");
  for (let n = 0; n < graph.order.length; n++) {
    const i = graph.order.get(n);
    const available = Math.max(0, rainfall.get(i)) + (years > 0 ? (melt?.get(i) ?? 0) / years : 0);
    runoff.set(
      i,
      graph.ocean.get(i)
        ? 0
        : Math.max(0, available - Number(context.parameters.evaporation)) *
            Number(context.parameters.runoffFraction)
    );
    flow.set(i, (runoff.get(i) * grid.measures.get(i)) / secondsPerYear);
  }
  const supplied = foldSamples(flow, (sum, v) => sum + v, 0);
  accumulateFlow(graph, flow, outlet);
  const outflow = foldSamples(outlet, (sum, v) => sum + v, 0);
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

function accumulateFlow(graph: Drainage, flow: Band, outlet: Band) {
  for (let n = graph.order.length - 1; n >= 0; n--) {
    const i = graph.order.get(n);
    const target = graph.receiver.get(i);
    if (target >= 0) flow.add(target, flow.get(i));
    else outlet.set(i, flow.get(i));
  }
}

export function writeDrainage(grid: Grid, graph: Drainage, seaLevel: number) {
  const values = (name: string) =>
    grid.coverage.scratch("float64", `drainage:${name}`, grid.active.length);
  const floor = grid.channels.elevation,
    depth = values("depth"),
    depression = values("depression"),
    water = values("water");
  for (let n = 0; n < graph.order.length; n++) {
    const i = graph.order.get(n);
    depression.set(i, Math.max(0, graph.height.get(i) - floor.get(i)));
    depth.set(
      i,
      graph.ocean.get(i)
        ? Math.max(0, seaLevel - floor.get(i))
        : grid.channels.flow.get(i) > 0
          ? depression.get(i)
          : 0
    );
    water.set(i, graph.ocean.get(i) ? 1 : depth.get(i) > 1e-8 ? 2 : 0);
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
