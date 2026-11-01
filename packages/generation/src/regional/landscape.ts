import { KeyedHeap } from "@atlas/domain";

/**
 * A landscape-evolution relaxation on the regional grid: uplift against implicit
 * stream-power incision (Braun & Willett 2013) and hillslope diffusion. Summits, cols,
 * ridges and branching valleys are outputs of the competition; the captured surface is a
 * long-wavelength anchor, never a pointwise target. Steps are numerical, never epochs.
 */
export interface LandscapeGrid {
  width: number;
  height: number;
  dx: number;
  dy: number;
}

export interface LandscapeInput {
  /** The evolving surface, updated in place. */
  height: Float64Array;
  /** Uplift (metres) distributed over this call's steps. */
  uplift: Float64Array;
  /** Long-wavelength anchor: the smoothed captured surface. */
  base: Float64Array;
  /** Cells held at their height and draining the map (connected sea). */
  sea: Uint8Array;
  /** Boundary cells that receive a river from beyond the frame instead of draining out. */
  inlet: Uint8Array;
  /** External discharge entering at inlets, in units of one reference cell's runoff. */
  inflow: Float64Array;
  /** Local runoff relative to the reference runoff. */
  runoff: Float64Array;
  /** Relative erodibility of the substrate, including cover and material organization. */
  erodibility: Float64Array;
  /** Cells whose closed depression is a captured lake basin and is not filled. */
  basin: Uint8Array;
  /** Glacial reworking 0..1: ice-carved hollows above `glacialDepth` keep their bowl. */
  reworking: Float64Array;
}

export interface LandscapeOptions {
  steps: number;
  /** Hillslope diffusion per step as a share of the neighbour difference. */
  diffusion: number;
  /** Gaussian anchor radius in cells (x, y); the anchor acts on wavelengths above it. */
  anchorSigma: [number, number];
  /** Share of the long-wavelength departure from the base removed at each anchoring. */
  anchorStrength: number;
  anchorEvery: number;
  /** Diagnostic hook after each operation of each step. */
  trace?(step: number, h: Float64Array, basin: Uint8Array, lip: Uint8Array, phase: string): void;
}

export interface LandscapeRoutes {
  receiver: Int32Array;
  order: Int32Array;
  count: number;
  filled: Float64Array;
}

/** Incision coefficient per step at one reference cell of discharge. */
const incision = 0.018;
/** Discharge exponent of the stream-power law, with slope exponent one. */
const dischargeExponent = 0.5;
/** Reworking above which a closed hollow in ice-carved ground is a tarn or trough basin. */
export const glacialReworking = 0.4;
/** Depth (m) a hollow in such ground needs before it is kept rather than filled. */
export const glacialDepth = 10;

/** Writes the in-grid 8-neighbours of `i` into `out`; returns how many there are. */
export function gridNeighbors(width: number, height: number, i: number, out: Int32Array) {
  const x = i % width,
    y = (i / width) | 0;
  let count = 0;
  for (let oy = -1; oy <= 1; oy++) {
    const yy = y + oy;
    if (yy < 0 || yy >= height) continue;
    for (let ox = -1; ox <= 1; ox++) {
      const xx = x + ox;
      if ((ox || oy) && xx >= 0 && xx < width) out[count++] = yy * width + xx;
    }
  }
  return count;
}

export function emptyRoutes(n: number): LandscapeRoutes {
  return {
    receiver: new Int32Array(n),
    order: new Int32Array(n),
    count: 0,
    filled: new Float64Array(n),
  };
}

export function evolveLandscape(
  grid: LandscapeGrid,
  input: LandscapeInput,
  options: LandscapeOptions
) {
  const n = grid.width * grid.height,
    h = input.height,
    discharge = new Float64Array(n),
    basin = new Uint8Array(n),
    lip = new Uint8Array(n),
    next = new Float64Array(n),
    routes = emptyRoutes(n),
    deposit = new Float64Array(n),
    perStep = 1 / Math.max(1, options.steps);
  for (let step = 0; step < options.steps; step++) {
    for (let i = 0; i < n; i++) if (!input.sea[i]) h[i] += input.uplift[i] * perStep;
    options.trace?.(step, h, basin, lip, "uplift");
    settle(grid, h, input, routes, basin, deposit);
    options.trace?.(step, h, basin, lip, "settle");
    markLips(grid, input, basin, lip);
    accumulate(routes, input, discharge);
    incise(grid, h, routes, input, discharge, basin, lip);
    options.trace?.(step, h, basin, lip, "incise");
    diffuse(grid, h, input.sea, basin, lip, next, options.diffusion);
    options.trace?.(step, h, basin, lip, "diffuse");
    if ((step + 1) % options.anchorEvery === 0)
      anchor(grid, h, input, next, options.anchorSigma, options.anchorStrength);
    options.trace?.(step, h, basin, lip, "anchor");
  }
  settle(grid, h, input, routes, basin, deposit);
  return { deposit };
}

/**
 * The rock rim of an ice-carved basin: every cell around it, including the lip its water
 * spills over. The outlet's whole catchment passes the lip, and the implicit incision and
 * creep would cut the rim down and drain the tarn within a few steps; the rim is held as
 * the glacier left it while the country around it goes on developing.
 */
function markLips(
  grid: LandscapeGrid,
  input: Pick<LandscapeInput, "reworking">,
  basin: Uint8Array,
  lip: Uint8Array
) {
  lip.fill(0);
  const around = new Int32Array(8);
  for (let i = 0; i < basin.length; i++) {
    if (!basin[i] || input.reworking[i] < glacialReworking) continue;
    const m = gridNeighbors(grid.width, grid.height, i, around);
    for (let k = 0; k < m; k++) if (!basin[around[k]]) lip[around[k]] = 1;
  }
}

/**
 * Hold the broad character: the departure from the captured base, smoothed over the anchor
 * radius, is partly removed. Summits stand above the base and valleys cut below it; only
 * the wavelengths the parent resolved are pulled back toward it.
 */
function anchor(
  grid: LandscapeGrid,
  h: Float64Array,
  input: LandscapeInput,
  scratch: Float64Array,
  [sx, sy]: [number, number],
  strength: number
) {
  for (let i = 0; i < h.length; i++) scratch[i] = input.sea[i] ? 0 : h[i] - input.base[i];
  gaussianBlur(scratch, grid.width, grid.height, sx, sy);
  for (let i = 0; i < h.length; i++) if (!input.sea[i]) h[i] -= scratch[i] * strength;
}

/** Separable Gaussian blur in place; sigmas in cells. */
export function gaussianBlur(
  values: Float64Array,
  width: number,
  height: number,
  sx: number,
  sy: number
) {
  const pass = (sigma: number, length: number, stride: number, lines: number, step: number) => {
    if (sigma < 0.5) return;
    const radius = Math.ceil(sigma * 3),
      kernel = Float64Array.from({ length: radius * 2 + 1 }, (_, k) =>
        Math.exp(-((k - radius) ** 2) / (2 * sigma * sigma))
      ),
      line = new Float64Array(length);
    for (let l = 0; l < lines; l++) {
      const start = l * step;
      for (let k = 0; k < length; k++) line[k] = values[start + k * stride];
      for (let k = 0; k < length; k++) {
        let sum = 0,
          weight = 0;
        for (let o = -radius; o <= radius; o++) {
          const at = k + o;
          if (at < 0 || at >= length) continue;
          sum += kernel[o + radius] * line[at];
          weight += kernel[o + radius];
        }
        values[start + k * stride] = sum / weight;
      }
    }
  };
  pass(sx, width, 1, height, width);
  pass(sy, height, width, width, 1);
}

/** Route the present surface and fill every closed pit except the basins that have a cause. */
function settle(
  grid: LandscapeGrid,
  h: Float64Array,
  input: LandscapeInput,
  routes: LandscapeRoutes,
  basin: Uint8Array,
  deposit: Float64Array
) {
  floodRoutes(grid, h, input.sea, input.inlet, routes);
  protectBasins(grid, h, routes.filled, input, basin);
  for (let i = 0; i < h.length; i++) {
    const rise = routes.filled[i] - h[i];
    if (input.sea[i] || basin[i] || rise <= 0) continue;
    deposit[i] += rise;
    h[i] = routes.filled[i];
  }
}

/** Priority flood from the sea and open frame edges, then steepest descent on the filled surface. */
export function floodRoutes(
  grid: LandscapeGrid,
  h: Float64Array,
  sea: Uint8Array,
  inlet: Uint8Array,
  routes: LandscapeRoutes
) {
  const { width, height } = grid,
    n = width * height,
    { receiver, order, filled } = routes,
    rank = new Int32Array(n).fill(-1),
    around = new Int32Array(8),
    heap = new KeyedHeap("min", "lower-first", Math.max(256, (width + height) * 4));
  receiver.fill(-1);
  filled.set(h);
  for (let i = 0; i < n; i++)
    if (sea[i] || (onEdge(grid, i) && !inlet[i])) {
      rank[i] = -2;
      heap.push(i, h[i]);
    }
  let count = 0;
  while (heap.size) {
    const i = heap.pop();
    rank[i] = count;
    order[count++] = i;
    const m = gridNeighbors(width, height, i, around);
    for (let k = 0; k < m; k++) {
      const j = around[k];
      if (rank[j] !== -1) continue;
      rank[j] = -2;
      receiver[j] = i;
      filled[j] = Math.max(h[j], filled[i] + 1e-6);
      heap.push(j, filled[j]);
    }
  }
  routes.count = count;
  steepestDescent(grid, rank, routes);
}

function onEdge(grid: LandscapeGrid, i: number) {
  const x = i % grid.width,
    y = (i / grid.width) | 0;
  return x === 0 || y === 0 || x === grid.width - 1 || y === grid.height - 1;
}

/** Sloping ground follows its steepest descent; the flood tree resolves flats and pits. */
function steepestDescent(grid: LandscapeGrid, rank: Int32Array, routes: LandscapeRoutes) {
  const { receiver, filled } = routes,
    around = new Int32Array(8);
  for (let i = 0; i < receiver.length; i++) {
    if (receiver[i] < 0) continue;
    const m = gridNeighbors(grid.width, grid.height, i, around);
    let steepest = 0;
    for (let k = 0; k < m; k++) {
      const j = around[k];
      if (rank[j] >= rank[i]) continue;
      const slope = (filled[i] - filled[j]) / cellDistance(grid, i, j);
      if (slope > steepest) {
        steepest = slope;
        receiver[i] = j;
      }
    }
  }
}

/**
 * Closed depressions with a cause keep their bowl: those touching a captured lake, and those
 * in ice-carved ground deep enough to be a tarn or a trough basin. Every other pit fills.
 */
export function protectBasins(
  grid: LandscapeGrid,
  h: Float64Array,
  filled: Float64Array,
  input: Pick<LandscapeInput, "basin" | "reworking">,
  out: Uint8Array
) {
  const queue = new Int32Array(h.length),
    around = new Int32Array(8),
    pit = (i: number) => filled[i] - h[i] > 0;
  out.fill(0);
  let write = 0;
  for (let i = 0; i < out.length; i++) {
    if (!pit(i)) continue;
    const glacial = input.reworking[i] >= glacialReworking && filled[i] - h[i] >= glacialDepth;
    if (input.basin[i] || glacial) {
      out[i] = 1;
      queue[write++] = i;
    }
  }
  for (let read = 0; read < write; read++) {
    const i = queue[read],
      m = gridNeighbors(grid.width, grid.height, i, around);
    for (let k = 0; k < m; k++) {
      const j = around[k];
      if (out[j] || !pit(j) || Math.abs(filled[j] - filled[i]) > 1e-3) continue;
      out[j] = 1;
      queue[write++] = j;
    }
  }
}

function accumulate(routes: LandscapeRoutes, input: LandscapeInput, discharge: Float64Array) {
  const { receiver, order, count } = routes;
  for (let i = 0; i < discharge.length; i++)
    discharge[i] = input.sea[i] ? 0 : input.runoff[i] + input.inflow[i];
  for (let k = count - 1; k >= 0; k--) {
    const i = order[k],
      j = receiver[i];
    if (j >= 0) discharge[j] += discharge[i];
  }
}

/** Implicit stream-power update, downstream first, so each bed grades to its updated outlet. */
function incise(
  grid: LandscapeGrid,
  h: Float64Array,
  routes: LandscapeRoutes,
  input: LandscapeInput,
  discharge: Float64Array,
  basin: Uint8Array,
  lip: Uint8Array
) {
  const { receiver, order, count } = routes,
    span = Math.sqrt(grid.dx * grid.dy);
  for (let k = 0; k < count; k++) {
    const i = order[k],
      j = receiver[i];
    if (j < 0 || input.sea[i] || basin[i] || lip[i]) continue;
    // A stream entering a kept basin grades to its water surface, not to its floor.
    const base = basin[j] ? routes.filled[j] : h[j];
    if (h[i] <= base) continue;
    const f =
      incision *
      input.erodibility[i] *
      discharge[i] ** dischargeExponent *
      (span / cellDistance(grid, i, j));
    h[i] = (h[i] + f * base) / (1 + f);
  }
}

function diffuse(
  grid: LandscapeGrid,
  h: Float64Array,
  sea: Uint8Array,
  basin: Uint8Array,
  lip: Uint8Array,
  next: Float64Array,
  diffusion: number
) {
  const around = new Int32Array(8);
  for (let i = 0; i < h.length; i++) {
    next[i] = h[i];
    // A kept basin and its rock lip hold their form; soil creeps around them.
    if (sea[i] || basin[i] || lip[i]) continue;
    const m = gridNeighbors(grid.width, grid.height, i, around);
    let sum = 0,
      weight = 0;
    for (let k = 0; k < m; k++) {
      const j = around[k];
      // The shoreline is a base level; soil does not diffuse into the sea floor, and a
      // kept basin's rim does not creep into its bowl.
      if (sea[j] || basin[j]) continue;
      const w = (j - i) % grid.width && Math.abs(j - i) > 1 ? 0.5 : 1;
      sum += w * h[j];
      weight += w;
    }
    if (weight) next[i] += diffusion * (sum / weight - h[i]) * Math.min(1, weight / 6);
  }
  h.set(next);
}

function cellDistance(grid: LandscapeGrid, i: number, j: number) {
  const ox = (i % grid.width) - (j % grid.width),
    oy = ((i / grid.width) | 0) - ((j / grid.width) | 0);
  return Math.hypot(ox * grid.dx, oy * grid.dy);
}
