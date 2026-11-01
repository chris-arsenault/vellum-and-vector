import { gridPosition, KeyedHeap } from "@atlas/domain";
import { fractalNoise } from "../canonry/noise";
import { capturedSinks, connectedSea, smoothedBase } from "./base";
import { grainAt } from "./character";
import { courseIndex } from "./courses";
import { edgeRing } from "./evidence";
import { materialBands, materialResistance } from "./material";
import {
  clamp,
  gridNeighbors,
  onFrameEdge,
  spacing,
  type NetworkWork,
  type RegionalState,
} from "./state";

/** Cost per metre of flowing uphill on the captured base, in metres of travel. */
const climbCost = 25;
/** Extra cost of a step across the grain at full coherence; along-strike steps are free. */
const grainAnisotropy = 2.5;
/**
 * A captured course is a valley at the parent's scale, not a one-cell trench: its ground is
 * cheaper over a share of the parent span either side, most on the line, so the developed
 * channel wanders within that valley. The parent's channel raster is a weaker corridor.
 */
const courseCorridor = 0.15,
  courseReachShare = 0.3,
  rasterCorridor = 0.5;
/** Cost near a known summit or cone, so channels run around it and it stands on a divide. */
const summitRepulsion = 12;
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
/** A river seat draws a channel to itself: the ground around it is cheaper to run through. */
const seatCorridor = 0.5;
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
const secondsPerYear = 365.25 * 24 * 3600;

/** Discharge of one interior sample at reference runoff, in m³/s. */
export function referenceDischarge(state: RegionalState) {
  const [dx, dy] = spacing(state.surface);
  return (referenceRunoff * dx * dy) / secondsPerYear;
}

/**
 * Grow the drainage network once (spec 7.3): a geodesic tree over the land, rooted at the
 * established waters (the connected sea, open frame edges, captured lakes and the parent's
 * closed basins), descending a cost field built from the captured base, the material bands
 * along the grain, the captured courses and the known summits, then re-routed through its
 * own channels. Where the network branches, joins, runs along strike or breaks through a
 * band is a consequence of those terms; no random geography is drawn.
 */
export function growNetwork(state: RegionalState): NetworkWork {
  const g = state.surface,
    n = g.active.length,
    datum = g.channels.seaLevel?.get(0) ?? 0,
    evidence = state.evidence!,
    base = smoothedBase(state, datum),
    sea = connectedSea(state, base, datum),
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
    level: new Float64Array(n).fill(datum),
    sea,
    base,
    lake,
    sink: capturedSinks(state, base, sea, lake),
  };
  for (const entry of evidence.entries) network.inflow[entry.cell] = entry.discharge;
  const root = networkRoots(state, network, datum),
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
  const { receiver, level } = network;
  for (let i = 0; i < n; i++) if (receiver[i] >= 0) level[i] = level[receiver[i]];
  state.network = network;
  return network;
}

/**
 * Roots: every land cell beside the sea or at an exit across the frame drains out; lake cells
 * receive their tributaries at the lake's level; a captured sink's floor receives its own.
 */
function networkRoots(state: RegionalState, network: NetworkWork, datum: number) {
  const g = state.surface,
    n = g.active.length,
    { sea, base, lake, sink, level } = network,
    evidence = state.evidence!,
    root = new Uint8Array(n),
    around = new Int32Array(8),
    guarded = entryProtection(state, evidence.entries),
    exits = edgeExits(state, base),
    shore = (i: number) => {
      const m = gridNeighbors(g.width, g.height, i, around);
      for (let k = 0; k < m; k++) if (sea[around[k]]) return true;
      return false;
    };
  for (let i = 0; i < n; i++) {
    if (sea[i]) continue;
    if (lake[i] >= 0) level[i] = evidence.lakes[lake[i]].level;
    else if (sink[i]) level[i] = base[i];
    else if (onFrameEdge(g, i) && !guarded[i] && exits[i]) level[i] = Math.max(base[i], datum + 1);
    else if (shore(i)) level[i] = datum;
    else continue;
    root[i] = 1;
  }
  return root;
}

/** The geodesic tree from the roots over the cost field, written into the network. */
function route(state: RegionalState, network: NetworkWork, cost: Float64Array, root: Uint8Array) {
  const g = state.surface,
    n = g.active.length,
    [dx, dy] = spacing(g),
    { receiver, order, sea, base, level } = network,
    travel = network.cost,
    heap = new KeyedHeap(),
    around = new Int32Array(8),
    character = state.character!,
    datum = g.channels.seaLevel?.get(0) ?? 0;
  travel.fill(Infinity);
  receiver.fill(-1);
  let count = 0;
  // The country continues beyond the frame: an exit across the edge, a lake or a sink still
  // has the fall to the sea ahead of it, so the lowest exits gather the largest catchments
  // instead of every edge cell draining its own strip.
  for (let i = 0; i < n; i++)
    if (root[i]) {
      travel[i] = climbCost * Math.max(0, level[i] - datum);
      heap.push(i, travel[i]);
    }
  const blocked = (i: number, j: number) => sea[j] || root[j] || travel[j] <= travel[i];
  while (heap.size) {
    const i = heap.pop();
    if (heap.poppedKey() !== travel[i]) continue;
    order[count++] = i;
    const m = gridNeighbors(g.width, g.height, i, around),
      { theta, coherence } = grainAt(character, i);
    for (let k = 0; k < m; k++) {
      const j = around[k];
      if (blocked(i, j)) continue;
      const ox = (j % g.width) - (i % g.width),
        oy = Math.floor(j / g.width) - Math.floor(i / g.width),
        length = Math.hypot(ox * dx, oy * dy),
        // The component of the step across the grain axis.
        across = Math.abs(-ox * dx * Math.sin(theta) + oy * dy * Math.cos(theta)) / length,
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
  const g = state.surface,
    c = g.channels,
    { receiver, order, count, area, flow, inflow, channel } = network,
    reference = referenceDischarge(state),
    [dx, dy] = spacing(g),
    cellArea = dx * dy;
  area.fill(0);
  flow.fill(0);
  for (let k = 0; k < count; k++) {
    const i = order[k],
      runoff = Math.max(0, c.runoff?.get(i) ?? referenceRunoff);
    area[i] = g.measures.get(i) + (inflow[i] / reference) * cellArea;
    flow[i] = (runoff * g.measures.get(i)) / secondsPerYear + inflow[i];
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
    channel[i] = Number(flow[i] >= threshold && network.lake[i] < 0);
  }
}

/** Mark the tree path from a cell down to the nearest channel as channel: the stream it stands on. */
export function promoteChannel(state: RegionalState, cell: number) {
  const network = state.network!,
    reference = referenceDischarge(state);
  for (let i = cell; i >= 0 && !network.channel[i]; i = network.receiver[i]) {
    if (network.flow[i] < channelCells * reference * 0.2) return false;
    network.channel[i] = 1;
  }
  return true;
}

/**
 * The cost of running water through a cell: material resistance (bands, rock, fractures),
 * repulsion around known summits and cones, the cheapness of captured courses and the
 * parent's channel raster, the pull of a river seat, and the heterogeneity that decides
 * between routes the organizing terms leave equal.
 */
function cellCosts(state: RegionalState, sea: Uint8Array, base: Float64Array) {
  const g = state.surface,
    n = g.active.length,
    [dx, dy] = spacing(g),
    cell = Math.min(dx, dy),
    evidence = state.evidence!,
    bands = materialBands(state),
    course = courseWeight(state, courseIndex(state, evidence.courses)),
    raster = g.channels.riverOrder,
    cost = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (sea[i]) continue;
    const p = gridPosition(g, i),
      amplitude =
        steepRoughness + (flatRoughness - steepRoughness) * flatness(state, base, i, dx, dy),
      roughness = fractalNoise(
        p.x,
        p.y,
        state.input.seed ^ 0x3a27,
        cell * roughnessCells,
        roughnessOctaves
      ),
      corridor = Math.min(
        1 - (1 - courseCorridor) * course[i],
        (raster?.get(i) ?? 0) > 0 ? rasterCorridor : 1
      );
    cost[i] = materialResistance(state, bands, i) * Math.exp(amplitude * roughness) * corridor;
  }
  // A summit's massif is as wide as its prominence suggests; a cone's as its footprint.
  for (const summit of evidence.summits)
    repel(state, cost, summit.cell, clamp(summit.prominence / 1000, 0.25, 1) * state.parentSpan);
  for (const cone of state.character!.cones) repel(state, cost, cone.cell, cone.radius);
  for (const seat of evidence.seats)
    if (seat.situation === "river") scaleAround(state, cost, seat.cell, 2, seatCorridor);
  return cost;
}

/** How flat the captured base is at a cell: one on a plain, zero on a slope. */
function flatness(state: RegionalState, base: Float64Array, i: number, dx: number, dy: number) {
  const g = state.surface,
    x = i % g.width,
    y = Math.floor(i / g.width),
    gx =
      (base[Math.min(g.width - 1, x + 1) + y * g.width] - base[Math.max(0, x - 1) + y * g.width]) /
      (2 * dx),
    gy =
      (base[x + Math.min(g.height - 1, y + 1) * g.width] - base[x + Math.max(0, y - 1) * g.width]) /
      (2 * dy);
  return clamp(1 - Math.hypot(gx, gy) / flatGradient);
}

/** Dear ground around a summit or cone, dearest on the cell itself. */
function repel(state: RegionalState, cost: Float64Array, center: number, reach: number) {
  const g = state.surface,
    [dx, dy] = spacing(g),
    cx = center % g.width,
    cy = Math.floor(center / g.width),
    rx = Math.ceil((reach * 2.5) / dx),
    ry = Math.ceil((reach * 2.5) / dy);
  for (let y = Math.max(0, cy - ry); y <= Math.min(g.height - 1, cy + ry); y++)
    for (let x = Math.max(0, cx - rx); x <= Math.min(g.width - 1, cx + rx); x++) {
      const i = y * g.width + x,
        d = Math.hypot((x - cx) * dx, (y - cy) * dy) / reach;
      cost[i] *= 1 + summitRepulsion * Math.exp(-d * d);
    }
  cost[center] *= 50;
}

function scaleAround(
  state: RegionalState,
  cost: Float64Array,
  center: number,
  r: number,
  by: number
) {
  const g = state.surface,
    cx = center % g.width,
    cy = Math.floor(center / g.width);
  for (let y = Math.max(0, cy - r); y <= Math.min(g.height - 1, cy + r); y++)
    for (let x = Math.max(0, cx - r); x <= Math.min(g.width - 1, cx + r); x++)
      cost[y * g.width + x] *= by;
}

/** 1 on a captured course, falling off over a share of the parent span beside it. */
function courseWeight(state: RegionalState, owner: Int32Array) {
  const g = state.surface,
    n = owner.length,
    [dx, dy] = spacing(g),
    reach = Math.max(2, Math.round((state.parentSpan * courseReachShare) / Math.min(dx, dy))),
    steps = new Int32Array(n).fill(-1),
    queue = new Int32Array(n),
    weight = new Float64Array(n),
    around = new Int32Array(8);
  let write = 0;
  for (let i = 0; i < n; i++)
    if (owner[i] >= 0) {
      steps[i] = 0;
      queue[write++] = i;
    }
  for (let read = 0; read < write; read++) {
    const i = queue[read],
      d = steps[i] / reach;
    weight[i] = Math.exp(-2 * d * d);
    if (steps[i] >= reach) continue;
    const m = gridNeighbors(g.width, g.height, i, around);
    for (let k = 0; k < m; k++) {
      const j = around[k];
      if (steps[j] >= 0) continue;
      steps[j] = steps[i] + 1;
      queue[write++] = j;
    }
  }
  return weight;
}

/**
 * Water leaves the frame through the valleys that cross it, not through every edge cell:
 * an exit is an edge cell that is the lowest of the captured base within a parent span
 * along the edge, or that the parent's channel raster leaves through.
 */
function edgeExits(state: RegionalState, base: Float64Array) {
  const g = state.surface,
    [dx, dy] = spacing(g),
    ring = edgeRing(g.width, g.height),
    window = Math.max(2, Math.round(state.parentSpan / Math.min(dx, dy))),
    exits = new Uint8Array(g.active.length),
    lowestAt = (k: number) => {
      const i = ring[k];
      for (let o = -window; o <= window; o++) {
        if (!o) continue;
        const j = ring[(k + o + ring.length) % ring.length];
        if (base[j] < base[i] || (base[j] === base[i] && j < i)) return false;
      }
      return true;
    };
  for (let k = 0; k < ring.length; k++) {
    const i = ring[k];
    if ((g.channels.riverOrder?.get(i) ?? 0) > 0 || lowestAt(k)) exits[i] = 1;
  }
  return exits;
}

/** Edge cells beside a river entry do not drain the entering river straight back out. */
function entryProtection(state: RegionalState, entries: { cell: number }[]) {
  const g = state.surface,
    guarded = new Uint8Array(g.active.length);
  for (const { cell } of entries) {
    const cx = cell % g.width,
      cy = Math.floor(cell / g.width);
    for (let y = Math.max(0, cy - 2); y <= Math.min(g.height - 1, cy + 2); y++)
      for (let x = Math.max(0, cx - 2); x <= Math.min(g.width - 1, cx + 2); x++)
        guarded[y * g.width + x] = 1;
  }
  return guarded;
}
