import { clamp, spacing, type RegionalState } from "./state";

/**
 * Macro character: how this country's local organization can develop (spec 3). Each
 * quantity biases a regional mechanism; none selects a finished landscape.
 */
export interface RegionalCharacter {
  /** Axial structural grain as doubled-angle components (cos 2θ, sin 2θ) times coherence 0..1. */
  grainX: Float64Array;
  grainY: Float64Array;
  /** Glacial reworking 0..1, from the captured cumulative glacial erosion. */
  reworking: Float64Array;
  /** Tectonic strain 0..1, the captured construction tendency. */
  strain: Float64Array;
  /** Discrete volcanic cones read from the captured construction history. */
  cones: { cell: number; radius: number; height: number }[];
  /** True when no grain was captured and it was inferred from the captured relief. */
  inferredGrain: boolean;
}

/** Glacial erosion (m) that counts as thorough reworking at any refinement level. */
const fullReworking = 40;
/** Captured volcanic construction (m) below which no cone is resolved. */
const coneFloor = 50;

export function deriveCharacter(state: RegionalState): RegionalCharacter {
  const g = state.surface,
    c = g.channels,
    n = g.active.length,
    grainX = new Float64Array(n),
    grainY = new Float64Array(n),
    reworking = new Float64Array(n),
    strain = new Float64Array(n),
    captured = readCapturedGrain(state, grainX, grainY);
  if (!captured) measureGrain(state, state.inheritedHeight, grainX, grainY);
  for (let i = 0; i < n; i++) {
    reworking[i] = clamp((c.glacialErosion?.get(i) ?? 0) / fullReworking);
    strain[i] = clamp(c.tectonicStrain?.get(i) ?? 0);
  }
  return {
    grainX,
    grainY,
    reworking,
    strain,
    cones: volcanicCones(state),
    inferredGrain: !captured,
  };
}

/** The world's published grain, where any cell carries one; returns whether any did. */
function readCapturedGrain(state: RegionalState, grainX: Float64Array, grainY: Float64Array) {
  const c = state.surface.channels;
  if (!c.structuralGrainX || !c.structuralGrainY) return false;
  let captured = false;
  for (let i = 0; i < grainX.length; i++) {
    const x = c.structuralGrainX.get(i),
      y = c.structuralGrainY.get(i),
      coherence = Math.hypot(x, y);
    if (coherence < 0.05) continue;
    captured = true;
    const scale = Math.min(1, coherence) / coherence;
    grainX[i] = x * scale;
    grainY[i] = y * scale;
  }
  return captured;
}

/** Axis angle θ (radians) and coherence at a cell, from the doubled-angle components. */
export function grainAt(character: RegionalCharacter, i: number) {
  const x = character.grainX[i],
    y = character.grainY[i],
    coherence = Math.hypot(x, y);
  return { theta: coherence ? Math.atan2(y, x) / 2 : 0, coherence };
}

/**
 * The axial organization of a height field at the parent sample scale: the structure tensor
 * of the height gradient, averaged over a parent span, gives the across-relief direction;
 * the grain is perpendicular to it and its coherence is the tensor's anisotropy, weighted by
 * how much relief there is to organize. Used where a map was captured before the world
 * published a grain, and to publish the child's own developed grain.
 */
export function measureGrain(
  state: RegionalState,
  h: { get(i: number): number },
  grainX: Float64Array,
  grainY: Float64Array
) {
  const g = state.surface,
    n = g.active.length,
    [dx, dy] = spacing(g),
    radius = Math.max(2, Math.round(state.parentSpan / Math.min(dx, dy))),
    xx = new Float64Array(n),
    yy = new Float64Array(n),
    xy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const { gx, gy } = heightGradient(state, h, i);
    xx[i] = gx * gx;
    yy[i] = gy * gy;
    xy[i] = gx * gy;
  }
  boxBlur(xx, g.width, g.height, radius);
  boxBlur(yy, g.width, g.height, radius);
  boxBlur(xy, g.width, g.height, radius);
  for (let i = 0; i < n; i++) {
    const trace = xx[i] + yy[i];
    if (trace <= 0) continue;
    const anisotropy = Math.hypot(xx[i] - yy[i], 2 * xy[i]) / trace,
      // The relief must be organized enough to matter: slopes of a few metres per km count little.
      relief = clamp(Math.sqrt(trace) / 0.02),
      coherence = clamp(anisotropy * relief);
    if (coherence < 0.05) continue;
    // Doubled angle of the gradient direction, then rotated by 180° for the perpendicular axis.
    const phi2 = Math.atan2(2 * xy[i], xx[i] - yy[i]);
    grainX[i] = -Math.cos(phi2) * coherence;
    grainY[i] = -Math.sin(phi2) * coherence;
  }
}

/** Central-difference gradient of a height field, one-sided at the frame edges. */
function heightGradient(state: RegionalState, h: { get(i: number): number }, i: number) {
  const g = state.surface,
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

/** Separable box average over ±radius cells, in place. */
export function boxBlur(values: Float64Array, width: number, height: number, radius: number) {
  const line = new Float64Array(Math.max(width, height)),
    prefix = new Float64Array(Math.max(width, height) + 1);
  const pass = (length: number, stride: number, lines: number, step: number) => {
    for (let l = 0; l < lines; l++) {
      const start = l * step;
      for (let k = 0; k < length; k++) line[k] = values[start + k * stride];
      prefix[0] = 0;
      for (let k = 0; k < length; k++) prefix[k + 1] = prefix[k] + line[k];
      for (let k = 0; k < length; k++) {
        const lo = Math.max(0, k - radius),
          hi = Math.min(length, k + radius + 1);
        values[start + k * stride] = (prefix[hi] - prefix[lo]) / (hi - lo);
      }
    }
  };
  pass(width, 1, height, width);
  pass(height, width, width, 1);
}

/** Local maxima of the captured volcanic construction become cones with a footprint. */
function volcanicCones(state: RegionalState) {
  const g = state.surface,
    values = g.channels.volcanicConstruction,
    cones: RegionalCharacter["cones"] = [];
  if (!values) return cones;
  const [dx, dy] = spacing(g),
    window = Math.max(2, Math.round(state.parentSpan / Math.min(dx, dy)));
  for (let i = 0; i < g.active.length; i++) {
    const value = values.get(i);
    if (value < coneFloor || g.channels.water?.get(i) === 1) continue;
    if (!localMaximum(values, g.width, g.height, i, window)) continue;
    cones.push({
      cell: i,
      radius: Math.max(2.5 * Math.min(dx, dy), state.parentSpan * 0.5 * Math.sqrt(value / 300)),
      height: Math.min(900, value) * 0.6,
    });
  }
  return cones;
}

/** Whether the cell holds the strict maximum of its window, ties going to the lower index. */
function localMaximum(
  values: { get(i: number): number },
  width: number,
  height: number,
  i: number,
  window: number
) {
  const x = i % width,
    y = Math.floor(i / width),
    value = values.get(i);
  for (let oy = -window; oy <= window; oy++)
    for (let ox = -window; ox <= window; ox++) {
      const xx = x + ox,
        yy = y + oy;
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
      const j = yy * width + xx,
        other = values.get(j);
      if (other > value || (other === value && j < i)) return false;
    }
  return true;
}
