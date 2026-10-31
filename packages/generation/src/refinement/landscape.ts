import { KeyedHeap } from "@atlas/domain";

/**
 * A landscape-evolution relaxation on the regional grid: implicit stream-power
 * incision (Braun & Willett 2013) and hillslope diffusion, pulled toward a target
 * surface. Valleys, ridges, summits and saddles emerge from the drainage network
 * rather than from noise thresholds. Steps are numerical, never geological epochs.
 */
export interface LandscapeGrid {
  width: number;
  height: number;
  dx: number;
  dy: number;
}

export interface LandscapeInput {
  /** Surface the relaxation is pulled toward; ridges settle near it. */
  target: Float64Array;
  /** Cells held at their target height and draining the map (connected sea). */
  sea: Uint8Array;
  /** Boundary cells that receive a river from beyond the frame instead of draining out. */
  inlet: Uint8Array;
  /** External discharge entering at inlets, in units of one reference cell's runoff. */
  inflow: Float64Array;
  /** Local runoff relative to the reference runoff. */
  runoff: Float64Array;
  /** Relative erodibility of the substrate. */
  erodibility: Float64Array;
  /** Cells whose closed depression is a captured lake basin and is not filled. */
  basin: Uint8Array;
}

export interface LandscapeRoutes {
  receiver: Int32Array;
  order: Int32Array;
  count: number;
  filled: Float64Array;
}

/** Fraction of the remaining distance to the target restored per step (uplift analogue). */
const restoring = 0.05;
/** Incision coefficient per step at one reference cell of discharge. */
const incision = 0.018;
/** Discharge exponent of the stream-power law, with slope exponent one. */
const dischargeExponent = 0.5;
/** Hillslope diffusion per step as a share of the neighbour difference. */
const diffusion = 0.12;
const steps = 48;

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

export function evolveLandscape(grid: LandscapeGrid, input: LandscapeInput) {
  const n = grid.width * grid.height,
    h = Float64Array.from(input.target),
    discharge = new Float64Array(n),
    basin = new Uint8Array(n),
    next = new Float64Array(n),
    routes = emptyRoutes(n),
    deposit = new Float64Array(n);
  for (let step = 0; step < steps; step++) {
    restore(h, input);
    settle(grid, h, input, routes, basin, deposit);
    accumulate(routes, input, discharge);
    incise(grid, h, routes, input, discharge, basin);
    diffuse(grid, h, input.sea, basin, next);
  }
  settle(grid, h, input, routes, basin, deposit);
  return { height: h, deposit };
}

function restore(h: Float64Array, input: LandscapeInput) {
  for (let i = 0; i < h.length; i++)
    if (!input.sea[i]) h[i] += (input.target[i] - h[i]) * restoring;
}

/** Route the present surface and fill every closed pit except captured lake basins. */
function settle(
  grid: LandscapeGrid,
  h: Float64Array,
  input: LandscapeInput,
  routes: LandscapeRoutes,
  basin: Uint8Array,
  deposit: Float64Array
) {
  floodRoutes(grid, h, input.sea, input.inlet, routes);
  protectBasins(grid, h, routes.filled, input.basin, basin);
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

/** Closed depressions touching a captured lake keep their bowl; every other pit is filled. */
function protectBasins(
  grid: LandscapeGrid,
  h: Float64Array,
  filled: Float64Array,
  basin: Uint8Array,
  out: Uint8Array
) {
  const queue = new Int32Array(h.length),
    around = new Int32Array(8),
    pit = (i: number) => filled[i] - h[i] > 0;
  out.fill(0);
  let write = 0;
  for (let i = 0; i < out.length; i++)
    if (basin[i] && pit(i)) {
      out[i] = 1;
      queue[write++] = i;
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
  basin: Uint8Array
) {
  const { receiver, order, count } = routes,
    span = Math.sqrt(grid.dx * grid.dy);
  for (let k = 0; k < count; k++) {
    const i = order[k],
      j = receiver[i];
    if (j < 0 || input.sea[i] || basin[i] || h[i] <= h[j]) continue;
    const f =
      incision *
      input.erodibility[i] *
      discharge[i] ** dischargeExponent *
      (span / cellDistance(grid, i, j));
    h[i] = (h[i] + f * h[j]) / (1 + f);
  }
}

function diffuse(
  grid: LandscapeGrid,
  h: Float64Array,
  sea: Uint8Array,
  basin: Uint8Array,
  next: Float64Array
) {
  const around = new Int32Array(8);
  for (let i = 0; i < h.length; i++) {
    next[i] = h[i];
    if (sea[i] || basin[i]) continue;
    const m = gridNeighbors(grid.width, grid.height, i, around);
    let sum = 0,
      weight = 0;
    for (let k = 0; k < m; k++) {
      const j = around[k];
      // The shoreline is a base level; soil does not diffuse into the sea floor.
      if (sea[j]) continue;
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
