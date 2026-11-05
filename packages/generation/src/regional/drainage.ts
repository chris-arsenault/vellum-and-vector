import { KeyedHeap } from "@atlas/domain";
import { potentialEvaporation } from "../canonry/ecologyEnvironment";
import { clearWaterSurface } from "../canonry/field";
import { baselineRock } from "../rock/rockCatalogue";
import { units } from "../canonry/math";
import { celsius, regionalPrecipitation } from "./climate";
import { channelMargins } from "./margins";
import {
  distance,
  isContent,
  neighborhood,
  neighborhoodCapacity,
  neighborsOf,
  regionalSpan,
} from "./lattice";
import { referenceDischarge, secondsPerYear } from "./network";
import { updateSlopes } from "./relief";
import { clamp, naturalBand, type RegionalState } from "./state";
import { enteringFlow, orderChannels, qualifyChannels } from "./channels";
import { lakeCells, poolDepth } from "./base";
import { riversIntoLakes, roundLakes } from "./lakeShores";

/** Annual seepage through intact ground and the additional loss through open fractures. */
const intactSeepage = 0.05;
const fracturedSeepage = 1.5;

/**
 * Transport and access on the present surface: the spill graph, discharge, mapped streams,
 * supported standing water and channel margins, written to the field's own water bands so
 * the world's lake, river and valley extraction read them. The drainage graph is a working
 * structure every later consumer (magic carriers, places, extraction) reads from the state.
 */
export function routeWater(state: RegionalState) {
  updateSlopes(state);
  const map = state.physical.map,
    mesh = map.mesh,
    datum = map.EffectiveSeaLevel,
    sea = seaConnected(state),
    filled = new Float64Array(mesh.count);
  const { receiver, order, count } = spillRoutes(state, filled, sea);
  for (let i = 0; i < mesh.count; i++) {
    if (!isContent(mesh, i)) continue;
    map.DrainageElevations.set(i, Math.round(filled[i]));
    if (sea[i]) {
      map.WaterKindCodes.set(i, 1);
      map.WaterBodyIds.set(i, 0);
      map.WaterDepths.set(i, Math.max(0, datum - map.Elevation.get(i)));
      map.WaterSurfaceElevations.set(i, datum);
    } else {
      map.WaterKindCodes.set(i, 0);
      map.WaterBodyIds.set(i, 0);
      clearWaterSurface(map, i);
    }
    map.LakeOutletTargets.set(i, -1);
    map.LakeOverflow.set(i, 0);
  }
  state.regional.drainage = { receiver, order, count };
  downhillRoutes(state, filled);
  accumulate(state);
  fillLakes(state, filled);
  roundLakes(state);
  riversIntoLakes(state);
  accumulate(state);
  for (let i = 0; i < mesh.count; i++)
    if (map.WaterKindCodes.get(i) !== 0) map.RiverOrders.set(i, 0);
  channelMargins(state);
}

/** Water at or below the datum joined to the captured ocean or the inherited exterior. */
function seaConnected(state: RegionalState) {
  const map = state.physical.map,
    mesh = map.mesh,
    datum = map.EffectiveSeaLevel,
    captured = naturalBand(state, "WaterKindCodes"),
    sea = new Uint8Array(mesh.count),
    queue = new Int32Array(mesh.count),
    around = new Int32Array(mesh.stride);
  let write = 0;
  for (let i = 0; i < mesh.count; i++)
    if (
      map.Elevation.get(i) <= datum &&
      (!isContent(mesh, i) || mesh.boundary(i) || captured.get(i) === 1)
    ) {
      sea[i] = 1;
      queue[write++] = i;
    }
  for (let read = 0; read < write; read++) {
    const m = neighborsOf(mesh, queue[read], around);
    for (let k = 0; k < m; k++) {
      const j = around[k];
      if (sea[j] || map.Elevation.get(j) > datum) continue;
      sea[j] = 1;
      queue[write++] = j;
    }
  }
  return sea;
}

/**
 * Priority flooding establishes local spill levels and an acyclic route from every content
 * cell to the sea or to the exterior: the inherited ground beyond the frame drains at its
 * own height, so water leaves where the country outside is lower. A captured river entering
 * across the frame is not an outlet.
 */
function spillRoutes(state: RegionalState, filled: Float64Array, sea: Uint8Array) {
  const map = state.physical.map,
    mesh = map.mesh,
    n = mesh.count,
    receiver = new Int32Array(n).fill(-1),
    order = new Int32Array(n),
    visited = new Uint8Array(n),
    heap = new KeyedHeap(),
    around = new Int32Array(neighborhoodCapacity);
  seedOutlets(state, filled, sea, visited, heap);
  const spill = (from: number, to: number) => {
    visited[to] = 1;
    receiver[to] = from;
    filled[to] = Math.max(map.Elevation.get(to), filled[from]);
    heap.push(to, filled[to]);
  };
  // An exterior cell does not pull a captured river's entry cell out of the frame.
  const admits = (from: number, to: number) =>
    !visited[to] && (isContent(mesh, from) || !enteringFlow(state, to));
  let count = 0;
  while (heap.size) {
    const i = heap.pop();
    if (isContent(mesh, i) && !sea[i]) order[count++] = i;
    const m = neighborhood(mesh, i, around);
    for (let k = 0; k < m; k++) if (admits(i, around[k])) spill(i, around[k]);
  }
  // Exterior and sea receivers end the content tree.
  for (let i = 0; i < n; i++) {
    const j = receiver[i];
    if (j >= 0 && (!isContent(mesh, j) || sea[j])) receiver[i] = -1;
  }
  return { receiver, order, count };
}
/** The sea, the exterior and the lattice edge are outlets at their own height. */
function seedOutlets(
  state: RegionalState,
  filled: Float64Array,
  sea: Uint8Array,
  visited: Uint8Array,
  heap: KeyedHeap
) {
  const map = state.physical.map,
    mesh = map.mesh,
    datum = map.EffectiveSeaLevel;
  for (let i = 0; i < mesh.count; i++) {
    filled[i] = map.Elevation.get(i);
    const outlet = sea[i] || !isContent(mesh, i) || (mesh.boundary(i) && !enteringFlow(state, i));
    if (!outlet) continue;
    visited[i] = 1;
    filled[i] = sea[i] ? datum : map.Elevation.get(i);
    heap.push(i, filled[i]);
  }
}
/**
 * The spill tree resolves flats; sloping ground follows its steepest descending neighbour,
 * which may be the sea or the exterior (every cell outside the tree is an outlet at its own
 * spill height). A captured river's entry cell keeps flowing inward.
 */
function downhillRoutes(state: RegionalState, filled: Float64Array) {
  const mesh = state.physical.map.mesh,
    graph = state.regional.drainage!,
    rank = new Int32Array(mesh.count).fill(-1),
    around = new Int32Array(neighborhoodCapacity);
  for (let k = 0; k < graph.count; k++) rank[graph.order[k]] = k;
  for (let k = 0; k < graph.count; k++) {
    const i = graph.order[k];
    if (graph.receiver[i] < 0) continue;
    const entering = enteringFlow(state, i) > 0;
    let steepest = 0,
      target = graph.receiver[i];
    const m = neighborhood(mesh, i, around);
    for (let n = 0; n < m; n++) {
      const j = around[n],
        outlet = rank[j] < 0;
      if ((outlet && entering) || rank[j] >= rank[i]) continue;
      const slope = (filled[i] - filled[j]) / distance(mesh, i, j);
      if (slope > steepest) {
        steepest = slope;
        target = outlet ? -1 : j;
      }
    }
    graph.receiver[i] = target;
  }
}

/** Discharge, catchment and the mapped network, written to the field's river bands. */
function accumulate(state: RegionalState) {
  const map = state.physical.map,
    mesh = map.mesh,
    { receiver, order, count } = state.regional.drainage!,
    cellArea = regionalSpan(state) ** 2,
    reference = referenceDischarge(state);
  for (let i = 0; i < mesh.count; i++) {
    map.FlowTargets.set(i, -1);
    map.RiverOrders.set(i, 0);
    map.FlowAccumulation.set(i, 0);
    map.CatchmentArea.set(i, 0);
    map.DrainageBasinIds.set(i, 0);
  }
  for (let k = 0; k < count; k++) {
    const i = order[k],
      entering = enteringFlow(state, i),
      // An entering river drains country beyond the frame, at about reference runoff.
      beyond = (entering / reference) * cellArea;
    map.CatchmentArea.set(i, mesh.contentArea(i) + beyond);
    map.FlowAccumulation.set(
      i,
      (Math.max(0, map.Runoff.get(i) / 1000) * mesh.contentArea(i)) / secondsPerYear + entering
    );
    map.FlowTargets.set(i, receiver[i]);
    map.DrainageBasinIds.set(i, receiver[i] < 0 ? i + 1 : map.DrainageBasinIds.get(receiver[i]));
  }
  for (let k = count - 1; k >= 0; k--) {
    const i = order[k],
      j = receiver[i];
    if (j < 0) continue;
    map.CatchmentArea.add(j, map.CatchmentArea.get(i));
    const flow = map.FlowAccumulation.get(i);
    map.FlowAccumulation.add(j, flow - transmissionLoss(state, i, j, flow));
  }
  qualifyChannels(state);
  orderChannels(state);
}

/** Channel belt half-width per square root of discharge (m), the ground a flow wets as it passes. */
const beltWidth = 80;
/**
 * Channel persistence (plan W1): the water a flow loses crossing a cell to seepage through
 * the bed (intact and fractured ground) and to evaporation where the climate takes more than
 * it gives, over the belt it wets. In dry or fractured country a channel loses more than its
 * catchment adds and falls below the river threshold: a dry valley with its incision kept.
 */
function transmissionLoss(state: RegionalState, i: number, j: number, flow: number) {
  if (flow <= 0) return 0;
  const map = state.physical.map,
    mesh = map.mesh,
    wetted = Math.min(regionalSpan(state), beltWidth * Math.sqrt(flow)) * distance(mesh, i, j),
    evaporation = Math.max(
      0,
      potentialEvaporation(celsius(state, i)) - regionalPrecipitation(state, i)
    ),
    rate = seepageRate(state, i) + evaporation;
  return Math.min(flow, (wetted * rate) / secondsPerYear);
}

/**
 * Standing water is supported by runoff and rain, not by the routing flood's fill height. A
 * captured lake is established evidence: it stands at its level wherever its bed lies under it.
 */
function fillLakes(state: RegionalState, filled: Float64Array) {
  const map = state.physical.map,
    mesh = map.mesh,
    seen = new Uint8Array(mesh.count);
  let body = placeCapturedLakes(state, filled, seen);
  for (let i = 0; i < mesh.count; i++) {
    if (
      seen[i] ||
      !isContent(mesh, i) ||
      map.WaterKindCodes.get(i) === 1 ||
      filled[i] - map.Elevation.get(i) <= units(poolDepth)
    )
      continue;
    const cells = pool(state, i, filled, seen);
    // A pool of a cell or two is a wet hollow the map does not draw as a lake.
    if (cells.length < lakeCells) continue;
    const stage = waterStage(state, cells, filled[i]);
    for (const cell of cells) {
      const depth = stage - map.Elevation.get(cell);
      if (depth <= units(poolDepth)) continue;
      setLake(state, cell, stage, body);
    }
    body++;
  }
}
function setLake(state: RegionalState, cell: number, stage: number, body: number) {
  const map = state.physical.map;
  map.WaterKindCodes.set(cell, 2);
  map.WaterBodyIds.set(cell, body);
  map.WaterDepths.set(cell, stage - map.Elevation.get(cell));
  map.WaterSurfaceElevations.set(cell, stage);
}
/** A captured lake stands at its level, or at its spill where the developed rim is higher. */
function placeCapturedLakes(state: RegionalState, filled: Float64Array, seen: Uint8Array) {
  const map = state.physical.map,
    mesh = map.mesh,
    datum = map.EffectiveSeaLevel,
    network = state.regional.network,
    body = 1;
  if (!network) return body;
  for (let i = 0; i < mesh.count; i++) {
    const k = network.lake[i];
    if (k < 0 || !isContent(mesh, i) || map.WaterKindCodes.get(i) === 1) continue;
    const level = Math.max(datum + units(state.regional.evidence!.lakes[k].level), filled[i]);
    if (level - map.Elevation.get(i) <= 0) continue;
    seen[i] = 1;
    setLake(state, i, level, body + k);
  }
  return body + state.regional.evidence!.lakes.length;
}
function pool(state: RegionalState, start: number, filled: Float64Array, seen: Uint8Array) {
  const map = state.physical.map,
    mesh = map.mesh,
    cells = [start],
    around = new Int32Array(mesh.stride);
  seen[start] = 1;
  for (let k = 0; k < cells.length; k++) {
    const m = neighborsOf(mesh, cells[k], around);
    for (let n = 0; n < m; n++) {
      const j = around[n];
      if (
        seen[j] ||
        !isContent(mesh, j) ||
        Math.abs(filled[j] - filled[start]) > 1 ||
        filled[j] - map.Elevation.get(j) <= units(poolDepth)
      )
        continue;
      seen[j] = 1;
      cells.push(j);
    }
  }
  return cells;
}
/**
 * The stage a basin's supply supports: the runoff its floor and its inflowing channels bring
 * fills a surface over which evaporation and seepage exceed the rain that falls on it. The
 * rain over dry parts of the basin is already in their runoff; it is not counted twice.
 */
function waterStage(state: RegionalState, cells: number[], spill: number) {
  const map = state.physical.map,
    mesh = map.mesh,
    { inflow, area, temperature, seepage, precipitation } = poolSupply(state, cells);
  const loss = Math.max(
      0.01,
      potentialEvaporation(temperature / area) + seepage / area - precipitation / area
    ),
    supportedArea = inflow / loss;
  if (supportedArea >= area) return spill;
  cells.sort((a, b) => map.Elevation.get(a) - map.Elevation.get(b));
  let covered = 0;
  for (const i of cells) {
    covered += mesh.contentArea(i);
    if (covered > supportedArea) return map.Elevation.get(i);
  }
  return spill;
}
function poolSupply(state: RegionalState, cells: number[]) {
  const map = state.physical.map,
    mesh = map.mesh,
    members = new Uint8Array(mesh.count),
    around = new Int32Array(mesh.stride);
  for (const i of cells) members[i] = 1;
  let inflow = 0,
    area = 0,
    temperature = 0,
    seepage = 0,
    precipitation = 0;
  for (const i of cells) {
    const measure = mesh.contentArea(i);
    area += measure;
    inflow += Math.max(0, map.Runoff.get(i) / 1000) * measure;
    precipitation += regionalPrecipitation(state, i) * measure;
    temperature += celsius(state, i) * measure;
    seepage += measure * seepageRate(state, i);
    const m = neighborsOf(mesh, i, around);
    for (let n = 0; n < m; n++) {
      const j = around[n];
      if (!members[j] && state.regional.drainage!.receiver[j] === i)
        inflow += map.FlowAccumulation.get(j) * secondsPerYear;
    }
  }
  return { inflow, area, temperature, seepage, precipitation };
}
function seepageRate(state: RegionalState, i: number) {
  const map = state.physical.map,
    rock = clamp(map.RockResistance.get(i) / baselineRock, 0.3, 3);
  return intactSeepage + (fracturedSeepage * clamp(map.FractureConductance.get(i) / 1000)) / rock;
}
