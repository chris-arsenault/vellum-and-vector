import { KeyedHeap } from "@atlas/domain";
import { hashUnit } from "../world/noise";
import {
  distance,
  isContent,
  neighborhood,
  neighborhoodCapacity,
  neighborsOf,
  regionalSpan,
} from "./lattice";
import { materialBands } from "./material";
import { channelCells, referenceDischarge } from "./network";
import type { NetworkWork, RegionalState } from "./state";

/**
 * Erosion steps the drainage is evolved through before the network is read from it. Each
 * step raises the ground where the parent stands high, routes the water down the present
 * surface and lets it cut; valleys deepen where they gather, lengthen headward and take the
 * water of their neighbours. Enough steps for uplift and incision to come into balance, so
 * the drainage is the one erosion organizes rather than the smoothed base's slope; the
 * relief itself is derived and calibrated to the parent afterwards.
 */
const evolutionSteps = 400;
/** Steps between re-readings of the drainage. */
const routingInterval = 8;
/** Uplift of one step as a share of the captured base's height above its base level. */
const upliftPerStep = 0.02;
/** How much a belt's structure varies its uplift: a fold axis rises this much more per band unit. */
const structuralUplift = 0.5;
/** Incision of one step where the upstream area is a channel's (implicit, so any value is stable). */
const incisionPerStep = 0.35;
/** Area exponent of stream power: larger rivers cut faster than their area alone. */
const areaExponent = 0.5;
/** Share of a channel's area below which water runs as sheet flow and only creep acts. */
const channelInitiation = 0.1;
/** Share of the difference to the neighbours' mean that hillslope creep removes per step. */
const creepPerStep = 0.35;
/** Unevenness (m) of the ground below the parent's resolution. */
const microRelief = 3;
/** A captured river's bed as a share of the smoothed base under it, and its least fall per cell (m). */
const courseDepth = 0.85,
  courseFall = 0.01;

/** A cell's neighbourhood, gathered once: the evolution reads it every step. */
interface Neighbourhood {
  start: Int32Array;
  cells: Int32Array;
  lengths: Float64Array;
}
function neighbourhoods(state: RegionalState): Neighbourhood {
  const mesh = state.physical.map.mesh,
    n = mesh.count,
    around = new Int32Array(neighborhoodCapacity),
    start = new Int32Array(n + 1),
    cells = new Int32Array(n * neighborhoodCapacity),
    lengths = new Float64Array(n * neighborhoodCapacity);
  let write = 0;
  for (let i = 0; i < n; i++) {
    start[i] = write;
    const m = neighborhood(mesh, i, around);
    for (let k = 0; k < m; k++) {
      cells[write] = around[k];
      lengths[write++] = distance(mesh, i, around[k]);
    }
  }
  start[n] = write;
  return { start, cells, lengths };
}

/**
 * The drainage evolved by erosion (spec 7.3, fluvial incision with capture): the smoothed
 * captured base is the starting surface and sets the uplift (high ground rises most), and
 * the roots (the sea's shore, the exits across the frame, captured lakes and the parent's
 * closed basins) are its base levels. Each step uplifts, routes
 * the water by steepest descent with depressions filled, gathers the upstream area, lets
 * channels cut by stream power through the ground's erodibility (the inverse of its cost:
 * material bands, rock, fractures, the established features' influence) and lets hillslopes
 * creep. Where the network branches, which valley captures which, and how the trunks wind
 * through the bands are consequences of that competition. The network is the final routing.
 */
export function evolveNetwork(
  state: RegionalState,
  network: NetworkWork,
  root: Uint8Array,
  cost: Float64Array
) {
  const mesh = state.physical.map.mesh,
    n = mesh.count,
    around = neighbourhoods(state),
    h = new Float64Array(n),
    area = new Float64Array(n),
    reference = channelCells * regionalSpan(state) ** 2,
    cellArea = regionalSpan(state) ** 2,
    inflowArea = (i: number) => (network.inflow[i] / referenceDischarge(state)) * cellArea;
  // The parent resolves nothing below its own cells: the ground carries the unevenness it
  // left unrecorded, which seeds the valleys' competition and decides nothing else.
  const seed = state.regional.input.seed ^ 0x51d7;
  for (let i = 0; i < n; i++)
    h[i] = root[i]
      ? network.level[i]
      : network.base[i] + microRelief * hashUnit(seed, mesh.identity(i), 0);
  carveCourses(state, network, root, h);
  const uplift = structuralUpliftField(state, network, root);
  for (let step = 0; step <= evolutionSteps; step++) {
    // The drainage shifts slowly between steps: it is re-read every few steps and at the end.
    if (step % routingInterval === 0 || step === evolutionSteps) {
      drain(state, network, root, h, around);
      gatherArea(state, network, area, inflowArea);
    }
    if (step === evolutionSteps) break;
    for (let i = 0; i < n; i++) h[i] += uplift[i];
    incise(state, network, h, area, cost, reference);
    creep(state, network, root, h);
  }
  network.cost.set(h);
}

/**
 * A belt rises along its structure: fold axes and resistant strata (the material bands,
 * continuous along the grain) stand up, the troughs between them lag. Base levels hold.
 */
function structuralUpliftField(state: RegionalState, network: NetworkWork, root: Uint8Array) {
  const bands = materialBands(state),
    uplift = new Float64Array(bands.length);
  for (let i = 0; i < uplift.length; i++)
    if (!root[i] && !network.sea[i])
      uplift[i] = upliftPerStep * Math.max(0, network.base[i]) * (1 + structuralUplift * bands[i]);
  return uplift;
}

/**
 * The parent's rivers are valleys of the ground the region starts from: each captured course
 * is cut below the smoothed base and made to descend along its own line, from its higher end
 * to its lower. Erosion then deepens it by the water it gathers and creep widens it; it stays
 * the trunk because it is the lowest and largest channel, not because it is held.
 */
function carveCourses(
  state: RegionalState,
  network: NetworkWork,
  root: Uint8Array,
  h: Float64Array
) {
  for (const course of state.regional.evidence?.courses ?? []) {
    const cells = Array.from(course.cells).filter((i) => !network.sea[i]);
    if (cells.length < 2) continue;
    if (network.base[cells[0]] < network.base[cells.at(-1)!]) cells.reverse();
    let level = Infinity;
    for (const i of cells) {
      level = Math.min(level - courseFall, courseDepth * network.base[i]);
      if (!root[i]) h[i] = Math.min(h[i], level);
    }
  }
}

/** Steepest descent over the depression-filled surface, every cell reaching a root. */
function drain(
  state: RegionalState,
  network: NetworkWork,
  root: Uint8Array,
  h: Float64Array,
  around: Neighbourhood
) {
  const { filled, rank } = flood(state, network, root, h, around),
    { receiver, order, count } = network;
  // On sloping ground the water takes the steepest way down among the cells already reached.
  for (let k = 0; k < count; k++) {
    const i = order[k];
    if (root[i]) continue;
    let steepest = 0;
    for (let e = around.start[i]; e < around.start[i + 1]; e++) {
      const j = around.cells[e];
      if (rank[j] < 0 || rank[j] >= rank[i]) continue;
      const slope = (filled[i] - filled[j]) / around.lengths[e];
      if (slope > steepest) {
        steepest = slope;
        receiver[i] = j;
      }
    }
  }
}

/**
 * Priority flood from the roots: the order cells are reached in (roots first), the flood
 * parent as each cell's provisional receiver, and the depression-filled height.
 */
function flood(
  state: RegionalState,
  network: NetworkWork,
  root: Uint8Array,
  h: Float64Array,
  around: Neighbourhood
) {
  const mesh = state.physical.map.mesh,
    n = mesh.count,
    { receiver, order, sea } = network,
    filled = new Float64Array(n),
    // -1 unreached, n queued, below n the position the cell was popped at.
    rank = new Int32Array(n).fill(-1),
    heap = new KeyedHeap();
  receiver.fill(-1);
  for (let i = 0; i < n; i++)
    if (root[i]) {
      filled[i] = h[i];
      rank[i] = n;
      heap.push(i, h[i]);
    }
  let count = 0;
  while (heap.size) {
    const i = heap.pop();
    if (rank[i] < n) continue;
    rank[i] = count;
    order[count++] = i;
    for (let k = around.start[i]; k < around.start[i + 1]; k++) {
      const j = around.cells[k];
      if (rank[j] !== -1 || sea[j] || !isContent(mesh, j)) continue;
      rank[j] = n;
      // A filled depression drains across its spill at a vanishing gradient.
      filled[j] = Math.max(h[j], filled[i] + 1e-6 * around.lengths[k]);
      receiver[j] = i;
      heap.push(j, filled[j]);
    }
  }
  network.count = count;
  return { filled, rank };
}

function gatherArea(
  state: RegionalState,
  network: NetworkWork,
  area: Float64Array,
  inflowArea: (i: number) => number
) {
  const mesh = state.physical.map.mesh,
    { receiver, order, count } = network;
  area.fill(0);
  for (let k = 0; k < count; k++) {
    const i = order[k];
    area[i] = mesh.contentArea(i) + inflowArea(i);
  }
  for (let k = count - 1; k >= 0; k--) {
    const i = order[k],
      j = receiver[i];
    if (j >= 0) area[j] += area[i];
  }
}

/** Implicit stream power, downstream first, so each cell cuts toward its lowered receiver. */
function incise(
  state: RegionalState,
  network: NetworkWork,
  h: Float64Array,
  area: Float64Array,
  cost: Float64Array,
  reference: number
) {
  const mesh = state.physical.map.mesh,
    { receiver, order, count } = network,
    span = regionalSpan(state);
  for (let k = 0; k < count; k++) {
    const i = order[k],
      j = receiver[i];
    if (j < 0 || h[i] <= h[j] || area[i] < channelInitiation * reference) continue;
    const factor =
      (incisionPerStep / Math.max(cost[i], 1e-3)) *
      (area[i] / reference) ** areaExponent *
      (span / distance(mesh, i, j));
    h[i] = (h[i] + factor * h[j]) / (1 + factor);
  }
}

/** Hillslope creep toward the neighbours' mean; base levels hold. */
function creep(state: RegionalState, network: NetworkWork, root: Uint8Array, h: Float64Array) {
  const mesh = state.physical.map.mesh,
    next = Float64Array.from(h),
    face = new Int32Array(mesh.stride);
  for (let i = 0; i < mesh.count; i++) {
    if (root[i] || network.sea[i] || !isContent(mesh, i)) continue;
    const m = neighborsOf(mesh, i, face);
    let sum = 0,
      used = 0;
    for (let k = 0; k < m; k++) {
      const j = face[k];
      if (network.sea[j] || !isContent(mesh, j)) continue;
      sum += h[j];
      used++;
    }
    if (used) next[i] = h[i] + creepPerStep * (sum / used - h[i]);
  }
  h.set(next);
}
