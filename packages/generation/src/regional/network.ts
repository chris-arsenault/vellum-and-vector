import { KeyedHeap } from "@atlas/domain";
import { fractalNoise } from "../canonry/noise";
import { capturedSinks, connectedSea, smoothedBase } from "./base";
import { influenceCosts } from "./causes/registry";
import { grainAt } from "./character";
import {
  distance,
  frameEdge,
  isContent,
  neighborhood,
  neighborhoodCapacity,
  neighborsOf,
  positionOf,
  regionalSpan,
  stepVector,
} from "./lattice";
import { materialBands, materialResistance } from "./material";
import { clamp, type NetworkWork, type RegionalState } from "./state";

/** Cost per metre of flowing uphill on the captured base, in metres of travel. */
const climbCost = 25;
/** Extra cost of a step across the grain at full coherence; along-strike steps are free. */
const grainAnisotropy = 2.5;
/** Cost near a known summit or cone, so channels run around it and it stands on a divide. */
const summitRepulsion = 12;
/**
 * Travel an exit, lake or sink root still owes per metre of its height: the fall to the sea
 * beyond the frame. Dearer than running the same height down inside the frame, so water on a
 * slope runs down to the low exit instead of leaving sideways where the exterior is level.
 */
const exitFall = 60;
/**
 * Heterogeneity of the ground: it decides between routes the organizing terms leave equal,
 * so a channel wanders where nothing else steers it. On a plain nothing else does, and the
 * water finds its way through every local unevenness; on a slope the fall decides.
 */
const steepRoughness = 0.5,
  flatRoughness = 1.6,
  flatGradient = 0.01,
  roughnessCells = 20,
  roughnessOctaves = 4;
/**
 * Capture: a channel that has gathered water is easier ground for more water, so its
 * neighbours' routes bend into it. The passes after the first re-route the country through
 * the channels the previous pass found; that is how tributaries join trunks.
 */
const capturePasses = 2,
  captureStrength = 0.7,
  captureFloor = 0.08,
  captureShare = 1 / 8;
/** Reference-runoff samples a mapped channel drains, in this map's own samples. */
export const channelCells = 128;
export const referenceRunoff = 0.4;
export const secondsPerYear = 365.25 * 24 * 3600;

/** Discharge of one interior sample at reference runoff, in m³/s. */
export function referenceDischarge(state: RegionalState) {
  return (referenceRunoff * regionalSpan(state) ** 2) / secondsPerYear;
}

/**
 * Grow the drainage network once (spec 7.3): a geodesic tree over the land, rooted at the
 * established waters (the connected sea, the valleys that leave the frame, captured lakes and
 * the parent's closed basins), descending a cost field built from the captured base, the
 * material bands along the grain, the captured courses and the known summits, then re-routed
 * through its own channels. Where the network branches, joins, runs along strike or breaks
 * through a band is a consequence of those terms; no random geography is drawn. Heights are
 * metres above the present sea level.
 */
export function growNetwork(state: RegionalState): NetworkWork {
  const map = state.physical.map,
    n = map.mesh.count,
    datum = map.EffectiveSeaLevel / 1024,
    evidence = state.regional.evidence!,
    base = smoothedBase(state, datum),
    sea = connectedSea(state, base),
    lake = new Int32Array(n).fill(-1);
  evidence.lakes.forEach(({ cells }, k) => {
    for (const i of cells) if (!sea[i]) lake[i] = k;
  });
  const network: NetworkWork = {
    receiver: new Int32Array(n).fill(-1),
    order: new Int32Array(n),
    count: 0,
    cost: new Float64Array(n),
    area: new Float64Array(n),
    flow: new Float64Array(n),
    inflow: new Float64Array(n),
    channel: new Uint8Array(n),
    level: new Float64Array(n),
    sea,
    base,
    lake,
    sink: capturedSinks(state, base, sea, lake),
  };
  for (const entry of evidence.entries) network.inflow[entry.cell] = entry.discharge;
  const root = networkRoots(state, network),
    ground = cellCosts(state, sea, base),
    cost = new Float64Array(ground),
    gathering = channelCells * referenceDischarge(state) * captureShare;
  for (let pass = 0; pass <= capturePasses; pass++) {
    if (pass > 0)
      for (let i = 0; i < n; i++)
        cost[i] =
          ground[i] *
          Math.max(
            captureFloor,
            1 / (1 + captureStrength * Math.log2(1 + network.flow[i] / gathering))
          );
    route(state, network, cost, root);
    gatherFlow(state, network);
  }
  // Every cell takes its root's level, receivers first (the order the tree was grown in).
  const { receiver, order, level } = network;
  for (let k = 0; k < network.count; k++) {
    const i = order[k];
    if (receiver[i] >= 0) level[i] = level[receiver[i]];
  }
  state.regional.network = network;
  return network;
}

/**
 * Roots: every land cell beside the sea or at an exit across the frame drains out; lake cells
 * receive their tributaries at the lake's level; a captured sink's floor receives its own. An
 * exit leaves at the base there, which the relief holds to along the whole frame edge.
 */
function networkRoots(state: RegionalState, network: NetworkWork) {
  const mesh = state.physical.map.mesh,
    n = mesh.count,
    { sea, base, lake, sink, level } = network,
    evidence = state.regional.evidence!,
    root = new Uint8Array(n),
    around = new Int32Array(mesh.stride),
    guarded = entryProtection(state, evidence.entries),
    exits = edgeExits(state),
    shore = (i: number) => {
      const m = neighborsOf(mesh, i, around);
      for (let k = 0; k < m; k++) if (sea[around[k]]) return true;
      return false;
    };
  for (let i = 0; i < n; i++) {
    if (sea[i] || !isContent(mesh, i)) continue;
    if (lake[i] >= 0) level[i] = evidence.lakes[lake[i]].level;
    else if (sink[i]) level[i] = base[i];
    else if (exits[i] && !guarded[i]) level[i] = Math.max(base[i], 1);
    else if (shore(i)) level[i] = 0;
    else continue;
    root[i] = 1;
  }
  return root;
}

/** The geodesic tree from the roots over the cost field, written into the network. */
function route(state: RegionalState, network: NetworkWork, cost: Float64Array, root: Uint8Array) {
  const mesh = state.physical.map.mesh,
    n = mesh.count,
    { receiver, order, sea, base } = network,
    travel = network.cost,
    heap = new KeyedHeap(),
    around = new Int32Array(neighborhoodCapacity(mesh)),
    character = state.regional.character!;
  travel.fill(Infinity);
  receiver.fill(-1);
  let count = 0;
  // The country continues beyond the frame: an exit across the edge, a lake or a sink still
  // has the fall to the sea ahead of it, so the lowest exits gather the largest catchments
  // instead of every edge cell draining its own strip.
  for (let i = 0; i < n; i++)
    if (root[i]) {
      // An exit owes the fall beyond the frame; a lake or sink root is the water's own end.
      const exit = network.lake[i] < 0 && !network.sink[i];
      travel[i] = (exit ? exitFall : climbCost) * Math.max(0, network.level[i]);
      heap.push(i, travel[i]);
    }
  const blocked = (i: number, j: number) =>
    sea[j] || root[j] || !isContent(mesh, j) || travel[j] <= travel[i];
  while (heap.size) {
    const i = heap.pop();
    if (heap.poppedKey() !== travel[i]) continue;
    order[count++] = i;
    const m = neighborhood(mesh, i, around),
      { theta, coherence } = grainAt(character, i);
    for (let k = 0; k < m; k++) {
      const j = around[k];
      if (blocked(i, j)) continue;
      const { dx, dy } = stepVector(mesh, i, j),
        length = Math.hypot(dx, dy),
        // The component of the step across the grain axis.
        across = Math.abs(-dx * Math.sin(theta) + dy * Math.cos(theta)) / length,
        anisotropy = 1 + grainAnisotropy * coherence * across * across,
        // Water runs from j to i: it must not climb the captured base on the way.
        climb = Math.max(0, base[i] - base[j]),
        next = travel[i] + length * ((cost[i] + cost[j]) / 2) * anisotropy + climbCost * climb;
      if (next >= travel[j]) continue;
      travel[j] = next;
      receiver[j] = i;
      heap.push(j, next);
    }
  }
  network.count = count;
}

/**
 * Upstream area and reference discharge gathered down the tree. An entering river drains
 * country beyond the frame at about reference runoff. A channel at this map's scale drains
 * `channelCells` samples' worth of reference runoff, so every refinement level shows a
 * similar stream density and dry country needs a larger catchment for the same flow.
 */
export function gatherFlow(state: RegionalState, network: NetworkWork) {
  const map = state.physical.map,
    mesh = map.mesh,
    { receiver, order, count, area, flow, inflow, channel } = network,
    reference = referenceDischarge(state),
    cellArea = regionalSpan(state) ** 2;
  area.fill(0);
  flow.fill(0);
  for (let k = 0; k < count; k++) {
    const i = order[k],
      runoff = Math.max(0, map.Runoff.get(i) / 1000);
    area[i] = mesh.contentArea(i) + (inflow[i] / reference) * cellArea;
    flow[i] = (runoff * mesh.contentArea(i)) / secondsPerYear + inflow[i];
  }
  for (let k = count - 1; k >= 0; k--) {
    const i = order[k],
      j = receiver[i];
    if (j < 0) continue;
    area[j] += area[i];
    flow[j] += flow[i];
  }
  const threshold = channelCells * reference;
  channel.fill(0);
  for (let k = 0; k < count; k++) {
    const i = order[k];
    channel[i] = Number(
      flow[i] >= threshold * slopeFactor(mesh, network, i) && network.lake[i] < 0
    );
  }
}
/** Gradient of the captured base at which the channel threshold is the reference. */
const referenceGradient = 0.02;
/**
 * The river network's slope factor (checklist row): gullies start earlier on steep ground
 * and later on plains, so a channel on a slope five times the reference needs less than half
 * the flow and one on a plain up to twice as much.
 */
function slopeFactor(
  mesh: RegionalState["physical"]["map"]["mesh"],
  network: NetworkWork,
  i: number
) {
  const j = network.receiver[i];
  if (j < 0) return 1;
  const gradient = Math.abs(network.base[i] - network.base[j]) / distance(mesh, i, j);
  return clamp(Math.sqrt(referenceGradient / Math.max(1e-4, gradient)), 0.5, 2);
}

/** Mark the tree path from a cell down to the nearest channel as channel: the stream it stands on. */
export function promoteChannel(state: RegionalState, cell: number) {
  const network = state.regional.network!,
    reference = referenceDischarge(state);
  for (let i = cell; i >= 0 && !network.channel[i]; i = network.receiver[i]) {
    if (network.flow[i] < channelCells * reference * 0.2) return false;
    network.channel[i] = 1;
  }
  return true;
}

/**
 * The cost of running water through a cell: material resistance (bands, rock, fractures),
 * the heterogeneity that decides between routes the organizing terms leave equal, repulsion
 * around the character's cones, and the established features' influence (summit massifs,
 * course corridors, river seats) through the cause registry.
 */
function cellCosts(state: RegionalState, sea: Uint8Array, base: Float64Array) {
  const map = state.physical.map,
    mesh = map.mesh,
    n = mesh.count,
    span = regionalSpan(state),
    bands = materialBands(state),
    cost = new Float64Array(n),
    flat = flatness(state, base);
  for (let i = 0; i < n; i++) {
    if (sea[i]) continue;
    const p = positionOf(mesh, i),
      amplitude = steepRoughness + (flatRoughness - steepRoughness) * flat[i],
      roughness = fractalNoise(
        p.x,
        p.y,
        state.regional.input.seed ^ 0x3a27,
        span * roughnessCells,
        roughnessOctaves
      );
    cost[i] = materialResistance(state, bands, i) * Math.exp(amplitude * roughness);
  }
  influenceCosts(state, cost);
  for (const cone of state.regional.character!.cones) repel(state, cost, cone.cell, cone.radius);
  return cost;
}

/** How flat the captured base is at each cell: one on a plain, zero on a slope. */
function flatness(state: RegionalState, base: Float64Array) {
  const mesh = state.physical.map.mesh,
    around = new Int32Array(mesh.stride),
    flat = new Float64Array(mesh.count);
  for (let i = 0; i < mesh.count; i++) {
    const m = neighborsOf(mesh, i, around);
    let steepest = 0;
    for (let k = 0; k < m; k++) {
      const j = around[k];
      steepest = Math.max(steepest, Math.abs(base[j] - base[i]) / distance(mesh, i, j));
    }
    flat[i] = clamp(1 - steepest / flatGradient);
  }
  return flat;
}

/** Cells within `reach` of a centre, by breadth-first walk, with their distances. */
function within(state: RegionalState, center: number, reach: number) {
  const mesh = state.physical.map.mesh,
    around = new Int32Array(mesh.stride),
    cells = [center],
    distances = [0],
    seen = new Uint8Array(mesh.count);
  seen[center] = 1;
  for (let head = 0; head < cells.length; head++) {
    const m = neighborsOf(mesh, cells[head], around);
    for (let k = 0; k < m; k++) {
      const j = around[k];
      if (seen[j]) continue;
      const d = distance(mesh, center, j);
      if (d > reach) continue;
      seen[j] = 1;
      cells.push(j);
      distances.push(d);
    }
  }
  return { cells, distances };
}

/** Dear ground around a summit or cone, dearest on the cell itself. */
export function repel(state: RegionalState, cost: Float64Array, center: number, reach: number) {
  const { cells, distances } = within(state, center, reach * 2.5);
  for (const [k, i] of cells.entries()) {
    const d = distances[k] / reach;
    cost[i] *= 1 + summitRepulsion * Math.exp(-d * d);
  }
  cost[center] *= 50;
}

/** Scale the cost of every cell within `reach` of a centre. */
export function scaleAround(
  state: RegionalState,
  cost: Float64Array,
  center: number,
  reach: number,
  by: number
) {
  for (const i of within(state, center, reach).cells) cost[i] *= by;
}

/**
 * Water leaves the frame wherever the exterior is no higher: an exit is a frame-edge cell
 * that the parent's channel raster leaves through, or that has exterior ground no higher
 * than itself to run on to. Every exit is a root at the parent's own ground there, so the
 * derived relief meets the exterior along the whole edge; a valley crossing the edge still
 * gathers the country around it, because its exit is the lowest root and the cost of
 * climbing the captured base keeps the flanks' water in it.
 */
function edgeExits(state: RegionalState) {
  const map = state.physical.map,
    mesh = map.mesh,
    n = mesh.count,
    exits = new Uint8Array(n),
    inherited = state.regional.inheritedHeight,
    around = new Int32Array(mesh.stride);
  const descends = (i: number) => {
    const m = neighborsOf(mesh, i, around);
    let exterior = false;
    for (let k = 0; k < m; k++) {
      const j = around[k];
      if (isContent(mesh, j)) continue;
      exterior = true;
      if (inherited.get(j) <= inherited.get(i)) return true;
    }
    return !exterior && mesh.boundary(i);
  };
  for (let i = 0; i < n; i++)
    if (frameEdge(mesh, i) && (map.RiverOrders.get(i) > 0 || descends(i))) exits[i] = 1;
  return exits;
}

/** Edge cells beside a river entry do not drain the entering river straight back out. */
function entryProtection(state: RegionalState, entries: { cell: number }[]) {
  const guarded = new Uint8Array(state.physical.map.mesh.count),
    reach = 2 * regionalSpan(state);
  for (const { cell } of entries) for (const i of within(state, cell, reach).cells) guarded[i] = 1;
  return guarded;
}
