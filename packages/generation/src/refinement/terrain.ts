import { fieldInterpolator, gridPosition } from "@atlas/domain";
import { fractalNoise } from "../canonry/noise";
import { emptyRoutes, evolveLandscape, floodRoutes, gridNeighbors } from "./landscape";
import {
  channel,
  clamp,
  regionalComponents,
  resolvesRegionalComponent,
  spacing,
  type RefinementState,
} from "./state";

/** Horizontal displacement varies coastlines and divides without serrating every height. */
const displacementShare = 0.18;
/** Smoothing radius, as a share of the parent sample span, removing the parent's patch creases. */
const baseSmoothing = 0.35;
/** Sea floor below this depth keeps its sampled value; shallower water is smoothed with the shore. */
const shelfDepth = 30;
/** Sub-parent relief seeding the drainage network, as a share of local parent relief. */
const roughnessShare = 0.3;
/** Minimum rolling relief as a slope over one parent sample. */
const rollingSlope = 0.002;
/** Runoff, in metres per year, that one reference cell of discharge represents. */
export const referenceRunoff = 0.4;
/** Share of reference runoff that occasional floods supply to valley cutting on dry ground. */
const floodRunoff = 0.3;
/** Depth distinguishing a newly formed basin (for example a magical hollow) from surface roughness. */
const newBasinDepth = 20;

/**
 * The parent surface is the specification; this map develops the next scale of
 * valleys, ridges, summits and saddles through a landscape-evolution relaxation.
 */
export function refineTerrain(state: RefinementState) {
  channel(state, "fracture", "ratio");
  channel(state, "rock", "ratio", 1);
  channel(state, "sediment", "metre");
  channel(state, "erosion", "metre");
  if (!state.input.domains.includes("physical")) {
    updateSlopes(state);
    return;
  }
  const g = state.surface,
    c = g.channels,
    n = g.active.length,
    [dx, dy] = spacing(g),
    datum = c.seaLevel?.get(0) ?? 0,
    base = smoothedBase(state, datum),
    target = roughTarget(state, base, datum),
    sea = connectedSea(state, target, datum),
    { inlet, inflow } = riverInlets(state, sea),
    { runoff, erodibility, basin } = substrate(state, sea),
    evolved = evolveLandscape(
      { width: g.width, height: g.height, dx, dy },
      { target, sea, inlet, inflow, runoff, erodibility, basin }
    ),
    captured = g.coverage.scratch("uint8", "regional:captured-basins", n),
    entering = g.coverage.scratch("float64", "regional:river-inflow", n);
  for (let i = 0; i < n; i++) {
    const h = sea[i] ? Math.min(target[i], datum - 1) : Math.max(evolved.height[i], datum + 1);
    c.elevation.set(i, h);
    c.erosion.set(i, Math.max(0, base[i] - h));
    c.sediment.add(i, evolved.deposit[i]);
    captured.set(i, basin[i]);
    entering.set(i, inflow[i] * referenceDischarge(state));
  }
  state.terrain = { basin: captured, inflow: entering };
  updateSlopes(state);
}

/** Sub-parent relief seeding the drainage network, scaled by the local parent relief. */
function roughTarget(state: RefinementState, base: Float64Array, datum: number) {
  const g = state.surface,
    [dx, dy] = spacing(g),
    relief = localRelief(state, base),
    target = new Float64Array(base.length),
    wavelength = Math.max(state.parentSpan, Math.max(dx, dy) * 4);
  for (let i = 0; i < base.length; i++) {
    const p = gridPosition(g, i),
      amplitude = relief[i] * roughnessShare + rollingSlope * state.parentSpan,
      variation = fractalNoise(p.x, p.y, state.input.seed ^ 0x5e1f, wavelength * 0.75, 4);
    target[i] = base[i] > datum ? base[i] + variation * amplitude : base[i];
  }
  return target;
}

/** Runoff, erodibility and captured lake basins in the solver's terms. */
function substrate(state: RefinementState, sea: Uint8Array) {
  const c = state.surface.channels,
    n = sea.length,
    runoff = new Float64Array(n),
    erodibility = new Float64Array(n),
    basin = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    // Episodic floods cut dry valleys too; mapped rivers still follow actual runoff.
    runoff[i] = Math.max(floodRunoff, (c.runoff?.get(i) ?? referenceRunoff) / referenceRunoff);
    erodibility[i] = (1 + 0.5 * clamp(c.fracture.get(i))) / clamp(c.rock.get(i) || 1, 0.5, 2);
    basin[i] = Number(!sea[i] && c.water?.get(i) === 2);
  }
  return { runoff, erodibility, basin };
}

/** Sample the parent surface with a gentle displacement, then smooth its interpolation creases. */
function smoothedBase(state: RefinementState, datum: number) {
  const g = state.surface,
    n = g.active.length,
    [dx, dy] = spacing(g),
    at = inheritedSampler(state),
    wavelength = Math.max(state.parentSpan, Math.max(dx, dy) * 4),
    sampled = new Float64Array(n),
    clamped = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = gridPosition(g, i),
      warpX = fractalNoise(p.x, p.y, state.input.seed ^ 0x51a3, wavelength * 2, 2),
      warpY = fractalNoise(p.x, p.y, state.input.seed ^ 0x7c4b, wavelength * 2, 2);
    sampled[i] = at(
      p.x + warpX * wavelength * displacementShare,
      p.y + warpY * wavelength * displacementShare
    );
    clamped[i] = Math.max(sampled[i], datum - shelfDepth);
  }
  const sigma = state.parentSpan * baseSmoothing;
  gaussianBlur(clamped, g.width, g.height, sigma / dx, sigma / dy);
  // The sea floor is smoothed on its own so deep water keeps its depth without the
  // parent's patch creases, and never pulls the shore down with it.
  gaussianBlur(sampled, g.width, g.height, sigma / dx, sigma / dy);
  for (let i = 0; i < n; i++) if (clamped[i] < datum) clamped[i] = Math.min(clamped[i], sampled[i]);
  return clamped;
}

export function inheritedSampler(state: RefinementState) {
  const g = state.surface,
    at = fieldInterpolator({ ...g, channels: { elevation: state.inheritedHeight } }, "elevation"),
    [w, s, e, n] = g.bounds;
  return (x: number, y: number) => at({ x: clamp(x, w, e), y: clamp(y, s, n), z: 0 });
}

function gaussianBlur(values: Float64Array, width: number, height: number, sx: number, sy: number) {
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

/** Height range across one parent sample span, which scales the new sub-parent relief. */
function localRelief(state: RefinementState, base: Float64Array) {
  const g = state.surface,
    [dx, dy] = spacing(g),
    rx = Math.max(1, Math.round(state.parentSpan / dx)),
    ry = Math.max(1, Math.round(state.parentSpan / dy)),
    relief = new Float64Array(base.length);
  for (let i = 0; i < base.length; i++) {
    const x = i % g.width,
      y = Math.floor(i / g.width);
    let low = base[i],
      high = base[i];
    for (let k = 0; k < 8; k++) {
      const angle = (k * Math.PI) / 4,
        xx = clamp(Math.round(x + Math.cos(angle) * rx), 0, g.width - 1),
        yy = clamp(Math.round(y + Math.sin(angle) * ry), 0, g.height - 1),
        h = base[yy * g.width + xx];
      low = Math.min(low, h);
      high = Math.max(high, h);
    }
    relief[i] = high - low;
  }
  return relief;
}

/** Water below the datum joined to the captured ocean or an open frame edge. */
function connectedSea(state: RefinementState, height: Float64Array, datum: number) {
  const g = state.surface,
    n = height.length,
    sea = new Uint8Array(n),
    queue = new Int32Array(n),
    around = new Int32Array(8),
    grid = { width: g.width, height: g.height, dx: 0, dy: 0 };
  let write = 0;
  for (let i = 0; i < n; i++)
    if (height[i] <= datum && (onEdge(grid, i) || g.channels.water?.get(i) === 1)) {
      sea[i] = 1;
      queue[write++] = i;
    }
  for (let read = 0; read < write; read++) {
    const m = gridNeighbors(g.width, g.height, queue[read], around);
    for (let k = 0; k < m; k++) {
      const j = around[k];
      if (sea[j] || height[j] > datum) continue;
      sea[j] = 1;
      queue[write++] = j;
    }
  }
  return sea;
}

/**
 * A captured river crossing the frame edge brings its upstream discharge with it.
 * Each crossing enters at the edge sample carrying the most captured flow.
 */
function riverInlets(state: RefinementState, sea: Uint8Array) {
  const g = state.surface,
    c = g.channels,
    n = g.active.length,
    inlet = new Uint8Array(n),
    inflow = new Float64Array(n),
    reference = referenceDischarge(state);
  if (!c.riverOrder || !c.flow) return { inlet, inflow };
  const edge = edgeRing(g.width, g.height),
    flow = (i: number) => (!sea[i] && c.riverOrder.get(i) > 0 ? c.flow.get(i) : 0);
  for (let k = 0; k < edge.length; k++) {
    const i = edge[k],
      before = flow(edge[(k - 1 + edge.length) % edge.length]),
      after = flow(edge[(k + 1) % edge.length]);
    if (flow(i) <= 0 || before > flow(i) || after >= flow(i) || !flowsInward(state, i)) continue;
    inlet[i] = 1;
    inflow[i] = flow(i) / reference;
  }
  return { inlet, inflow };
}

/** Frame edge samples in order around the rectangle. */
function edgeRing(width: number, height: number) {
  const edge: number[] = [];
  for (let x = 0; x < width; x++) edge.push(x);
  for (let y = 1; y < height; y++) edge.push(y * width + width - 1);
  for (let x = width - 2; x >= 0; x--) edge.push((height - 1) * width + x);
  for (let y = height - 2; y > 0; y--) edge.push(y * width);
  return edge;
}
function onEdge(grid: { width: number; height: number }, i: number) {
  const x = i % grid.width,
    y = Math.floor(i / grid.width);
  return x === 0 || y === 0 || x === grid.width - 1 || y === grid.height - 1;
}
const secondsPerYear = 365.25 * 24 * 3600;
/** Discharge of one interior sample at reference runoff, in m³/s. */
export function referenceDischarge(state: RefinementState) {
  const [dx, dy] = spacing(state.surface);
  return (referenceRunoff * dx * dy) / secondsPerYear;
}

/** The captured surface descends from the edge sample into the frame. */
function flowsInward(state: RefinementState, i: number) {
  const g = state.surface,
    h = state.inheritedHeight,
    x = i % g.width,
    y = Math.floor(i / g.width),
    inner =
      clamp(y + (y === 0 ? 2 : y === g.height - 1 ? -2 : 0), 0, g.height - 1) * g.width +
      clamp(x + (x === 0 ? 2 : x === g.width - 1 ? -2 : 0), 0, g.width - 1);
  return h.get(inner) < h.get(i);
}

/**
 * Fill closed depressions after a later change to the surface. Captured lake basins
 * and substantial new basins (a magical hollow) remain; sub-resolution pits drain.
 */
export function fillRegionalPits(state: RefinementState) {
  const g = state.surface,
    n = g.active.length,
    [dx, dy] = spacing(g),
    { height, sea } = presentSurface(state),
    routes = emptyRoutes(n);
  floodRoutes({ width: g.width, height: g.height, dx, dy }, height, sea, new Uint8Array(n), routes);
  const kept = retainedBasins(state, height, sea, routes.filled);
  for (let i = 0; i < n; i++) {
    if (sea[i] || kept[i] || routes.filled[i] <= height[i]) continue;
    const deposit = routes.filled[i] - height[i];
    g.channels.elevation.set(i, routes.filled[i]);
    g.channels.sediment?.add(i, deposit);
  }
}
function presentSurface(state: RefinementState) {
  const c = state.surface.channels,
    n = state.surface.active.length,
    height = new Float64Array(n),
    sea = new Uint8Array(n),
    datum = c.seaLevel?.get(0) ?? 0;
  for (let i = 0; i < n; i++) {
    height[i] = c.elevation.get(i);
    sea[i] = Number(c.water?.get(i) === 1 && height[i] <= datum);
  }
  return { height, sea };
}

function retainedBasins(
  state: RefinementState,
  height: Float64Array,
  sea: Uint8Array,
  filled: Float64Array
) {
  const g = state.surface,
    kept = new Uint8Array(height.length);
  regionalComponents(
    g,
    (i) => !sea[i] && filled[i] - height[i] > 1e-3,
    (members) => {
      let captured = false,
        depth = 0;
      for (const i of members) {
        captured ||= Boolean(state.terrain?.basin.get(i));
        depth = Math.max(depth, filled[i] - height[i]);
      }
      if (captured || (depth >= newBasinDepth && resolvesRegionalComponent(g, members)))
        for (const i of members) kept[i] = 1;
    }
  );
  return kept;
}

export function gradient(state: RefinementState, i: number, inherited = false) {
  const g = state.surface,
    h = inherited ? state.inheritedHeight : g.channels.elevation,
    [dx, dy] = spacing(g),
    x = i % g.width,
    y = Math.floor(i / g.width),
    left = x > 0 ? i - 1 : i,
    right = x + 1 < g.width ? i + 1 : i,
    below = y > 0 ? i - g.width : i,
    above = y + 1 < g.height ? i + g.width : i;
  return {
    gx: (h.get(right) - h.get(left)) / ((right - left) * dx || dx),
    gy: (h.get(above) - h.get(below)) / (((above - below) / g.width) * dy || dy),
  };
}
export function updateSlopes(state: RefinementState) {
  const slope = channel(state, "slope", "ratio");
  for (let i = 0; i < slope.length; i++) {
    const { gx, gy } = gradient(state, i);
    slope.set(i, Math.hypot(gx, gy));
  }
}
