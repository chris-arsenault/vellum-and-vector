import { isContent, neighborsOf, regionalSpan } from "./lattice";
import { materialBands, materialResistance } from "./material";
import { clamp, naturalBand, type NetworkWork, type RegionalState } from "./state";

/** Cells of open sea upwind that count as full fetch, and the flanking rays' turn (radians). */
const fetchCells = 24,
  flankTurn = Math.PI / 5;
/** Cut (m) of a fully exposed shore cell of baseline material in one round, and how many cells inland the sea's work reaches. */
const cutDepth = 12,
  cutReachCells = 3;
/** A sea cell this shallow (m) beside land can fill in the lee; it emerges this much above the datum. */
const fillDepth = 10,
  emergence = 1;
/** Exposure below which a shore is shelter where sediment settles, and below which a loaded mouth builds a delta. */
const shelterExposure = 0.3,
  deltaExposure = 0.5;
/** Mouth load (m³) per cell of shallow sea within reach that makes a delta rather than an estuary. */
const deltaLoad = 50_000;
/** Estuary deepening (m) per square root of the mouth's discharge (m³/s), bounded. */
const estuaryDeepening = 0.6,
  estuaryLimit = 25;

/**
 * Shore development (plan W4) and mouth form (W3) as relief terms. Each shore cell reads its
 * exposure (fetch of open sea along the captured wind, sheltered by the present coast); the
 * exposed shore is cut over its material's resistance, and a cell cut below the datum is sea,
 * so coves follow the weak bands and resistant bands stand as headlands. The cut volume and
 * the rivers' mouth loads settle in shelter: the least exposed shallow sea beside land fills
 * first and emerges as spits and bars in a headland's lee. A river mouth with a large load
 * into sheltered water builds a delta; otherwise it is an estuary deepened by its discharge.
 * Re-derived each round from the same captured wind and material.
 */
export function developShore(state: RegionalState, h: Float64Array) {
  const map = state.physical.map,
    mesh = map.mesh,
    exposure = shoreExposure(state, h),
    cut = new Uint8Array(mesh.count);
  for (let i = 0; i < mesh.count; i++)
    if (exposure[i] >= 0) map.WaveExposure.set(i, Math.round(exposure[i] * 1000));
  let eroded = cutShore(state, h, exposure, cut);
  eroded += formMouths(state, h, exposure);
  fillShelter(state, h, exposure, eroded);
  return cut;
}

/**
 * The sea cuts inward from the water's edge: a cell is cut only once a neighbour nearer the
 * sea is water, so a cove is always joined to the sea and never a pit behind a headland.
 * Returns the cut volume; marks the cells it lowered.
 */
function cutShore(state: RegionalState, h: Float64Array, exposure: Float64Array, cut: Uint8Array) {
  const mesh = state.physical.map.mesh,
    network = state.regional.network!,
    bands = materialBands(state),
    around = new Int32Array(mesh.stride),
    water = (j: number) => network.sea[j] === 1 || h[j] <= 0,
    besideWater = (i: number) => {
      const m = neighborsOf(mesh, i, around);
      for (let k = 0; k < m; k++) if (water(around[k])) return true;
      return false;
    };
  let eroded = 0;
  for (let pass = 0; pass <= cutReachCells; pass++)
    for (let i = 0; i < mesh.count; i++) {
      if (exposure[i] <= 0 || cut[i] || network.sea[i] || h[i] <= 0 || !besideWater(i)) continue;
      const depth = Math.min(
        h[i] + emergence,
        (cutDepth * exposure[i]) / materialResistance(state, bands, i)
      );
      if (depth <= 0) continue;
      h[i] -= depth;
      cut[i] = 1;
      eroded += depth * mesh.contentArea(i);
    }
  return eroded;
}

/**
 * Exposure 0..1 of every cell beside the sea (land or shallow sea), −1 elsewhere: the share
 * of the fetch along the wind and its two flanking rays that is open sea.
 */
function shoreExposure(state: RegionalState, h: Float64Array) {
  const map = state.physical.map,
    mesh = map.mesh,
    network = state.regional.network!,
    windX = naturalBand(state, "WindX"),
    windY = naturalBand(state, "WindY"),
    exposure = new Float64Array(mesh.count).fill(-1),
    around = new Int32Array(mesh.stride),
    span = regionalSpan(state),
    water = (j: number) => network.sea[j] === 1 || h[j] <= 0;
  for (let i = 0; i < mesh.count; i++) {
    if (!isContent(mesh, i)) continue;
    const m = neighborsOf(mesh, i, around);
    let beside = false;
    for (let k = 0; k < m && !beside; k++) beside = water(around[k]) !== water(i);
    if (!beside) continue;
    const wx = windX.get(i) / 1000,
      wy = windY.get(i) / 1000,
      angle = Math.atan2(wy, wx),
      rays = [angle, angle + flankTurn, angle - flankTurn].map((a) =>
        fetchAlong(mesh, water, i, -Math.cos(a) * span, -Math.sin(a) * span)
      );
    exposure[i] = clamp((rays[0] + 0.5 * (rays[1] + rays[2])) / 2);
  }
  spreadInland(mesh, water, exposure);
  return exposure;
}
/** The shore's exposure reaches a few cells inland, fading: the sea works a belt, not a line. */
function spreadInland(
  mesh: RegionalState["physical"]["map"]["mesh"],
  water: (j: number) => boolean,
  exposure: Float64Array
) {
  const around = new Int32Array(mesh.stride),
    steps = new Int32Array(mesh.count).fill(-1),
    queue: number[] = [];
  for (let i = 0; i < mesh.count; i++)
    if (exposure[i] >= 0 && !water(i)) {
      steps[i] = 0;
      queue.push(i);
    }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    if (steps[i] >= cutReachCells) continue;
    const m = neighborsOf(mesh, i, around);
    for (let k = 0; k < m; k++) {
      const j = around[k];
      if (steps[j] >= 0 || water(j) || !isContent(mesh, j)) continue;
      steps[j] = steps[i] + 1;
      exposure[j] = exposure[i] * (1 - steps[j] / (cutReachCells + 1));
      queue.push(j);
    }
  }
}
/** Share of `fetchCells` steps upwind that are open sea before land or the frame ends the ray. */
function fetchAlong(
  mesh: RegionalState["physical"]["map"]["mesh"],
  water: (j: number) => boolean,
  from: number,
  dx: number,
  dy: number
) {
  let x = mesh.x(from),
    y = mesh.y(from),
    open = 0;
  for (let step = 1; step <= fetchCells; step++) {
    x += dx;
    y += dy;
    const j = mesh.cellAt(x, y);
    if (j < 0) return 1;
    if (!water(j)) break;
    open++;
  }
  return open / fetchCells;
}

/** Deltas and estuaries at the shore roots that carry a mouth load; returns the load left for the lee. */
function formMouths(state: RegionalState, h: Float64Array, exposure: Float64Array) {
  const mesh = state.physical.map.mesh,
    network = state.regional.network!,
    mouthLoad = state.regional.sediment?.mouthLoad,
    around = new Int32Array(mesh.stride);
  if (!mouthLoad) return 0;
  let spare = 0;
  for (let i = 0; i < mesh.count; i++) {
    if (!isContent(mesh, i) || !isMouth(network, i)) continue;
    const shallows = shallowSea(state, h, i, around);
    if (
      mouthLoad[i] > deltaLoad * shallows.length &&
      exposure[i] < deltaExposure &&
      shallows.length
    ) {
      spare += buildDelta(mesh, h, shallows, mouthLoad[i]);
    } else {
      h[i] -= Math.min(estuaryLimit, estuaryDeepening * Math.sqrt(network.flow[i]));
      spare += mouthLoad[i];
    }
  }
  return spare;
}
/** A shore root carrying flow: where a river meets the sea. */
const isMouth = (network: NetworkWork, i: number) =>
  network.receiver[i] < 0 &&
  !network.sea[i] &&
  network.level[i] <= 0 &&
  network.lake[i] < 0 &&
  !network.sink[i] &&
  network.flow[i] > 0;
/** Shallow sea cells beside a mouth, out to two cells. */
function shallowSea(state: RegionalState, h: Float64Array, mouth: number, around: Int32Array) {
  const mesh = state.physical.map.mesh,
    found: number[] = [],
    seen = new Set<number>([mouth]), // hpc-exempt: a few cells around one river mouth
    queue = [mouth];
  for (let head = 0; head < queue.length && head < 32; head++) {
    const m = neighborsOf(mesh, queue[head], around);
    for (let k = 0; k < m; k++) {
      const j = around[k];
      if (seen.has(j) || !isContent(mesh, j)) continue;
      seen.add(j);
      if (state.regional.network!.sea[j] && h[j] > -fillDepth) {
        found.push(j);
        queue.push(j);
      }
    }
  }
  return found;
}
/** Fill the shallows to emergence from the load; returns what the load could not place. */
function buildDelta(
  mesh: RegionalState["physical"]["map"]["mesh"],
  h: Float64Array,
  shallows: number[],
  load: number
) {
  let left = load;
  for (const j of shallows) {
    const rise = Math.min(emergence - h[j], left / mesh.contentArea(j));
    if (rise <= 0) continue;
    h[j] += rise;
    left -= rise * mesh.contentArea(j);
  }
  return Math.max(0, left);
}

/** The cut volume and spare loads fill the least exposed shallows beside land, emerging as bars. */
function fillShelter(
  state: RegionalState,
  h: Float64Array,
  exposure: Float64Array,
  volume: number
) {
  const mesh = state.physical.map.mesh,
    sea = state.regional.network!.sea,
    sheltered: number[] = [];
  // Only the sea's own shallows fill: never a lake floor or ground the cut has just taken.
  for (let i = 0; i < mesh.count; i++)
    if (exposure[i] >= 0 && exposure[i] < shelterExposure && sea[i] && h[i] > -fillDepth)
      sheltered.push(i);
  sheltered.sort((a, b) => exposure[a] - exposure[b] || a - b);
  let left = volume;
  for (const j of sheltered) {
    if (left <= 0) break;
    const rise = Math.min(emergence - h[j], left / mesh.contentArea(j));
    if (rise <= 0) continue;
    h[j] += rise;
    left -= rise * mesh.contentArea(j);
  }
}
