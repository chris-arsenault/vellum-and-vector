import { KeyedHeap, resolutionCells, type Band } from "@atlas/domain";
import { potentialEvaporation } from "../canonry/ecologyEnvironment";
import { regionalPrecipitation } from "./climate";
import {
  channel,
  clamp,
  distance,
  neighbors,
  onFrameEdge,
  spacing,
  type RegionalState,
} from "./state";
import { referenceDischarge, updateSlopes } from "./relief";

const secondsPerYear = 365.25 * 24 * 3600;
/** Reference-runoff samples a mapped river drains, in this map's own samples. */
const riverCells = 128;
/** Samples a headwater runs before it is drawn as a river. */
const headwaterCells = 4;
/** Annual seepage through intact ground and the additional loss through open fractures. */
const intactSeepage = 0.05;
const fracturedSeepage = 1.5;
/** Floodplain half-width per square root of mean discharge, in metres. */
const floodWidth = 80;
/** Only low-gradient channel margins retain floodwater. */
const floodplainGradient = 0.012;

/**
 * Transport and access on the present surface: the spill graph, discharge, mapped streams,
 * supported standing water and channel margins. The drainage graph is a working structure
 * every later consumer (magic carriers, places, extraction) reads from the state.
 */
export function routeWater(state: RegionalState) {
  updateSlopes(state);
  const g = state.surface,
    n = g.active.length,
    height = g.channels.elevation,
    datum = channel(state, "seaLevel", "metre").get(0),
    sea = seaConnected(state, datum),
    filled = channel(state, "drainageElevation", "metre"),
    water = channel(state, "water", "category"),
    depth = channel(state, "waterDepth", "metre"),
    level = channel(state, "waterLevel", "metre");
  const { receiver, order, count } = spillRoutes(state, height, filled, sea, datum);
  for (let i = 0; i < n; i++) {
    water.set(i, sea.get(i));
    depth.set(i, sea.get(i) ? Math.max(0, datum - height.get(i)) : 0);
    level.set(i, sea.get(i) ? datum : height.get(i));
  }
  if (state.drainage) {
    g.coverage.release(state.drainage.receiver);
    g.coverage.release(state.drainage.order);
  }
  state.drainage = { receiver, order, count };
  downhillRoutes(state, filled);
  accumulate(state);
  fillLakes(state);
  for (let i = 0; i < n; i++) if (water.get(i) !== 0) g.channels.riverOrder.set(i, 0);
  channelMargins(state);
  g.coverage.release(sea);
}

function seaConnected(state: RegionalState, datum: number) {
  const g = state.surface,
    sea = g.coverage.scratch("uint8", "regional:sea", g.active.length),
    queue = g.coverage.scratch("int32", "regional:sea-queue", g.active.length);
  let read = 0,
    write = 0;
  for (let i = 0; i < g.active.length; i++)
    if (
      (onFrameEdge(g, i) || g.channels.water?.get(i) === 1) &&
      g.channels.elevation.get(i) <= datum
    ) {
      sea.set(i, 1);
      queue.set(write++, i);
    }
  while (read < write) {
    const i = queue.get(read++);
    for (const j of neighbors(g, i))
      if (!sea.get(j) && g.channels.elevation.get(j) <= datum) {
        sea.set(j, 1);
        queue.set(write++, j);
      }
  }
  g.coverage.release(queue);
  return sea;
}

/** Priority flooding establishes local spill levels and an acyclic route to open map edges. */
function spillRoutes(state: RegionalState, height: Band, filled: Band, sea: Band, datum: number) {
  const g = state.surface,
    n = g.active.length,
    receiver = g.coverage.scratch("int32", "regional:receiver", n).fill(-1),
    order = g.coverage.scratch("int32", "regional:drainage-order", n),
    visited = g.coverage.scratch("uint8", "regional:flood-seen", n),
    heap = new KeyedHeap();
  filled.copyFrom(height);
  for (let i = 0; i < n; i++)
    if (outlet(state, i, sea)) {
      const ocean = Boolean(sea.get(i));
      visited.set(i, 1);
      const spill = ocean ? datum : height.get(i);
      heap.push(i, spill);
      filled.set(i, spill);
    }
  let count = 0;
  while (heap.size) {
    const i = heap.pop();
    order.set(count++, i);
    for (const j of neighbors(g, i))
      if (!visited.get(j)) {
        visited.set(j, 1);
        receiver.set(j, i);
        const spill = Math.max(height.get(j), filled.get(i));
        filled.set(j, spill);
        heap.push(j, spill);
      }
  }
  g.coverage.release(visited);
  return { receiver, order, count };
}

/** Open frame edges drain out, except where a captured river enters across them. */
function outlet(state: RegionalState, i: number, sea: Band) {
  return Boolean(sea.get(i)) || (onFrameEdge(state.surface, i) && !enteringFlow(state, i));
}
/** Discharge a captured river brings across the frame edge at this cell (m³/s). */
function enteringFlow(state: RegionalState, i: number) {
  return state.network?.inflow[i] ?? 0;
}

/** The spill tree resolves flats; sloping ground follows its steepest descending neighbor. */
function downhillRoutes(state: RegionalState, filled: Band) {
  const g = state.surface,
    graph = state.drainage!,
    rank = g.coverage.scratch("int32", "regional:flow-rank", g.active.length);
  for (let k = 0; k < graph.count; k++) rank.set(graph.order.get(k), k);
  for (let i = 0; i < g.active.length; i++) {
    if (graph.receiver.get(i) < 0) continue;
    let steepest = 0,
      target = graph.receiver.get(i);
    for (const j of neighbors(g, i)) {
      if (rank.get(j) >= rank.get(i)) continue;
      const slope = (filled.get(i) - filled.get(j)) / distance(g, i, j);
      if (slope > steepest) {
        steepest = slope;
        target = j;
      }
    }
    graph.receiver.set(i, target);
  }
  g.coverage.release(rank);
}

function accumulate(state: RegionalState) {
  const g = state.surface,
    { receiver, order, count } = state.drainage!,
    flow = channel(state, "flow", "cubic-metre/second"),
    area = channel(state, "catchmentArea", "square-metre"),
    runoff = channel(state, "runoff", "metre/year", 0.4),
    river = channel(state, "riverOrder", "category"),
    [dx, dy] = spacing(g),
    cellArea = dx * dy;
  for (let i = 0; i < g.active.length; i++) {
    const land = g.channels.water.get(i) !== 1,
      entering = enteringFlow(state, i),
      // An entering river drains country beyond the frame, at about reference runoff.
      beyond = (entering / referenceDischarge(state)) * cellArea;
    area.set(i, land ? g.measures.get(i) + beyond : 0);
    flow.set(
      i,
      land ? (Math.max(0, runoff.get(i)) * g.measures.get(i)) / secondsPerYear + entering : 0
    );
    river.set(i, 0);
  }
  for (let k = count - 1; k >= 0; k--) {
    const i = order.get(k),
      j = receiver.get(i);
    if (j < 0) continue;
    area.add(j, area.get(i));
    flow.add(j, flow.get(i));
  }
  qualifyChannels(state, river, flow);
  orderChannels(state, river);
}

/**
 * A mapped river drains at least `riverCells` samples' worth of reference runoff. The
 * threshold is in this map's own samples, so every refinement level shows a similar
 * stream density, while dry or permeable ground needs a larger catchment for the same flow.
 */
function qualifyChannels(state: RegionalState, river: Band, flow: Band) {
  const g = state.surface,
    threshold = riverCells * referenceDischarge(state),
    [dx, dy] = spacing(g),
    span = Math.sqrt(dx * dy),
    flowPath = upstreamLengths(state, () => true);
  // A channel gathers water from a catchment wider than one sample; a strip
  // accumulating down a planar slope is sheet flow, however much it carries.
  for (let i = 0; i < g.active.length; i++)
    if (
      waterLand(state, i) &&
      flow.get(i) >= threshold &&
      g.channels.catchmentArea.get(i) / (flowPath[i] + span) >= resolutionCells * span
    )
      river.set(i, 1);
  // Generalize the network like a map at this scale: a headwater shorter than a few
  // samples (a planar hillslope's parallel rills) is not drawn, and every stream
  // begins once it has run that far. A river entering across the frame edge has
  // already run that far upstream.
  const shortest = headwaterCells * span,
    length = upstreamLengths(
      state,
      (i) => river.get(i) > 0,
      (i) => (enteringFlow(state, i) > 0 ? shortest : 0)
    );
  for (let i = 0; i < g.active.length; i++) if (length[i] < shortest) river.set(i, 0);
}
/** Longest upstream path through cells that `along` admits, from each start length. */
function upstreamLengths(
  state: RegionalState,
  along: (i: number) => boolean,
  start: (i: number) => number = () => 0
) {
  const g = state.surface,
    { receiver, order, count } = state.drainage!,
    length = new Float64Array(g.active.length);
  for (let i = 0; i < length.length; i++) length[i] = start(i);
  for (let k = count - 1; k >= 0; k--) {
    const i = order.get(k),
      j = receiver.get(i);
    if (j >= 0 && along(i) && along(j))
      length[j] = Math.max(length[j], length[i] + distance(g, i, j));
  }
  return length;
}
function orderChannels(state: RegionalState, river: Band) {
  const g = state.surface,
    { receiver, order, count } = state.drainage!,
    largest = g.coverage.scratch("int32", "regional:largest-order", g.active.length),
    ties = g.coverage.scratch("int32", "regional:order-ties", g.active.length);
  for (let k = count - 1; k >= 0; k--) {
    const i = order.get(k),
      j = receiver.get(i);
    if (river.get(i)) river.set(i, Math.max(1, largest.get(i) + (ties.get(i) > 1 ? 1 : 0)));
    if (j < 0) continue;
    if (river.get(i) && waterLand(state, j)) river.set(j, Math.max(1, river.get(j)));
    if (river.get(i) > largest.get(j)) {
      largest.set(j, river.get(i));
      ties.set(j, 1);
    } else if (river.get(i) === largest.get(j)) ties.add(j, 1);
  }
  g.coverage.release(largest);
  g.coverage.release(ties);
}
function waterLand(state: RegionalState, i: number) {
  return state.surface.channels.water.get(i) !== 1;
}

/**
 * Standing water is supported by runoff and rain, not by the routing flood's fill height. A
 * captured lake is established evidence: it stands at its level wherever its bed lies under it.
 */
function fillLakes(state: RegionalState) {
  const g = state.surface,
    seen = g.coverage.scratch("uint8", "regional:lake-seen", g.active.length),
    spill = g.channels.drainageElevation,
    height = g.channels.elevation;
  placeCapturedLakes(state, seen);
  for (let i = 0; i < g.active.length; i++) {
    if (seen.get(i) || g.channels.water.get(i) === 1 || spill.get(i) - height.get(i) <= 2) continue;
    const cells = pool(state, i, seen),
      stage = waterStage(state, cells, spill.get(i));
    for (const cell of cells) {
      const depth = stage - height.get(cell);
      if (depth <= 2) continue;
      g.channels.water.set(cell, 2);
      g.channels.waterDepth.set(cell, depth);
      g.channels.waterLevel.set(cell, stage);
    }
  }
  g.coverage.release(seen);
}
/** A captured lake stands at its level, or at its spill where the developed rim is higher. */
function placeCapturedLakes(state: RegionalState, seen: Band) {
  const g = state.surface,
    c = g.channels,
    network = state.network;
  if (!network) return;
  for (let i = 0; i < g.active.length; i++) {
    const k = network.lake[i];
    if (k < 0 || c.water.get(i) === 1) continue;
    const level = Math.max(state.evidence!.lakes[k].level, c.drainageElevation.get(i)),
      depth = level - c.elevation.get(i);
    if (depth <= 0) continue;
    seen.set(i, 1);
    c.water.set(i, 2);
    c.waterDepth.set(i, depth);
    c.waterLevel.set(i, level);
  }
}
function pool(state: RegionalState, start: number, seen: Band) {
  const g = state.surface,
    spill = g.channels.drainageElevation,
    height = g.channels.elevation,
    cells = [start];
  seen.set(start, 1);
  for (let k = 0; k < cells.length; k++)
    for (const j of neighbors(g, cells[k])) {
      if (
        seen.get(j) ||
        Math.abs(spill.get(j) - spill.get(start)) > 1e-6 ||
        spill.get(j) - height.get(j) <= 2
      )
        continue;
      seen.set(j, 1);
      cells.push(j);
    }
  return cells;
}
/**
 * The stage a basin's supply supports: the runoff its floor and its inflowing channels bring
 * fills a surface over which evaporation and seepage exceed the rain that falls on it. The
 * rain over dry parts of the basin is already in their runoff; it is not counted twice.
 */
function waterStage(state: RegionalState, cells: number[], spill: number) {
  const g = state.surface,
    height = g.channels.elevation,
    { inflow, area, temperature, seepage, precipitation } = poolSupply(state, cells);
  const loss = Math.max(
      0.01,
      potentialEvaporation(temperature / area) + seepage / area - precipitation / area
    ),
    supportedArea = inflow / loss;
  if (supportedArea >= area) return spill;
  cells.sort((a, b) => height.get(a) - height.get(b));
  let covered = 0;
  for (const i of cells) {
    covered += g.measures.get(i);
    if (covered > supportedArea) return height.get(i);
  }
  return spill;
}
function poolSupply(state: RegionalState, cells: number[]) {
  const g = state.surface,
    members = new Set(cells);
  let inflow = 0,
    area = 0,
    temperature = 0,
    seepage = 0,
    precipitation = 0;
  for (const i of cells) {
    const measure = g.measures.get(i);
    area += measure;
    inflow += Math.max(0, g.channels.runoff?.get(i) ?? 0) * measure;
    precipitation += regionalPrecipitation(state, i) * measure;
    temperature += (g.channels.temperature?.get(i) ?? 15) * measure;
    seepage += measure * seepageRate(state, i);
    for (const j of neighbors(g, i))
      if (!members.has(j) && state.drainage!.receiver.get(j) === i)
        inflow += g.channels.flow.get(j) * secondsPerYear;
  }
  return { inflow, area, temperature, seepage, precipitation };
}
function seepageRate(state: RegionalState, i: number) {
  const c = state.surface.channels;
  return (
    intactSeepage +
    (fracturedSeepage * clamp(c.fracture?.get(i) ?? 0)) / clamp(c.rock?.get(i) ?? 1, 0.3, 3)
  );
}

/** Resolve local channel margins rather than painting an inherited coarse floodplain everywhere. */
function channelMargins(state: RegionalState) {
  const g = state.surface,
    floodplain = channel(state, "floodplain", "ratio").fill(0),
    delta = channel(state, "delta", "ratio").fill(0),
    [dx, dy] = spacing(g),
    span = Math.sqrt(dx * dy);
  for (let i = 0; i < g.active.length; i++) {
    if (g.channels.riverOrder.get(i) <= 0 || g.channels.water.get(i) !== 0) continue;
    const width = Math.sqrt(g.channels.flow.get(i)) * floodWidth,
      coast = [...neighbors(g, i)].some((j) => g.channels.water.get(j) === 1);
    for (const j of [i, ...neighbors(g, i)]) {
      if (g.channels.water.get(j) !== 0) continue;
      const flat = clamp(1 - g.channels.slope.get(j) / floodplainGradient),
        covered = clamp((width - distance(g, i, j)) / span) * flat;
      floodplain.set(j, Math.max(floodplain.get(j), covered));
      if (coast) delta.set(j, Math.max(delta.get(j), covered));
    }
  }
}
