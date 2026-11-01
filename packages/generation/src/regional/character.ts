import { physicalGradients } from "../canonry/physicalMetric";
import { releaseWorking } from "../canonry/physicalNumerics";
import { distance, isContent, neighborsOf, regionalSpan, smoothOverLength } from "./lattice";
import { clamp, type RegionalState } from "./state";

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
/** Grain below this coherence is noise, not organization. */
const coherenceFloor = 0.05;

export function deriveCharacter(state: RegionalState): RegionalCharacter {
  const map = state.physical.map,
    n = map.mesh.count,
    grainX = new Float64Array(n),
    grainY = new Float64Array(n),
    reworking = new Float64Array(n),
    strain = new Float64Array(n),
    captured = readCapturedGrain(state, grainX, grainY);
  if (!captured)
    measureGrain(state, (i) => state.regional.inheritedHeight.get(i) / 1024, grainX, grainY);
  for (let i = 0; i < n; i++) {
    reworking[i] = clamp(map.CumulativeGlacialErosion.get(i) / 1024 / fullReworking);
    strain[i] = clamp(map.TectonicStrain.get(i) / 1000);
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
  const map = state.physical.map;
  let captured = false;
  for (let i = 0; i < grainX.length; i++) {
    const x = map.StructuralGrainX.get(i) / 1000,
      y = map.StructuralGrainY.get(i) / 1000,
      coherence = Math.hypot(x, y);
    if (coherence < coherenceFloor) continue;
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
  height: (i: number) => number,
  grainX: Float64Array,
  grainY: Float64Array
) {
  const map = state.physical.map,
    mesh = map.mesh,
    n = mesh.count,
    gradients = physicalGradients(mesh, height, map.coverage),
    xx = new Float64Array(n),
    yy = new Float64Array(n),
    xy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const gx = gradients.x.get(i),
      gy = gradients.y.get(i);
    xx[i] = gx * gx;
    yy[i] = gy * gy;
    xy[i] = gx * gy;
  }
  releaseWorking(map, gradients.x, gradients.y);
  // A box average over a parent span either side has about this Gaussian spread.
  const reach = state.regional.parentSpan * 0.6;
  for (const values of [xx, yy, xy]) smoothOverLength(state, values, reach);
  for (let i = 0; i < n; i++) {
    const trace = xx[i] + yy[i];
    if (trace <= 0) continue;
    const anisotropy = Math.hypot(xx[i] - yy[i], 2 * xy[i]) / trace,
      // The relief must be organized enough to matter: slopes of a few metres per km count little.
      relief = clamp(Math.sqrt(trace) / 0.02),
      coherence = clamp(anisotropy * relief);
    if (coherence < coherenceFloor) continue;
    // Doubled angle of the gradient direction, then rotated by 180° for the perpendicular axis.
    const phi2 = Math.atan2(2 * xy[i], xx[i] - yy[i]);
    grainX[i] = -Math.cos(phi2) * coherence;
    grainY[i] = -Math.sin(phi2) * coherence;
  }
}

/** Local maxima of the captured volcanic construction become cones with a footprint. */
function volcanicCones(state: RegionalState) {
  const map = state.physical.map,
    mesh = map.mesh,
    cones: RegionalCharacter["cones"] = [],
    span = regionalSpan(state),
    window = Math.max(2 * span, state.regional.parentSpan),
    construction = (i: number) => map.VolcanicConstructionHistory.get(i) / 1024;
  for (let i = 0; i < mesh.count; i++) {
    const value = construction(i);
    if (!isContent(mesh, i) || value < coneFloor || map.WaterKindCodes.get(i) === 1) continue;
    if (!localMaximum(mesh, construction, i, window)) continue;
    cones.push({
      cell: i,
      radius: Math.max(2.5 * span, state.regional.parentSpan * 0.5 * Math.sqrt(value / 300)),
      height: Math.min(900, value) * 0.6,
    });
  }
  return cones;
}

/** Whether the cell holds the strict maximum within `radius`, ties going to the lower index. */
function localMaximum(
  mesh: RegionalState["physical"]["map"]["mesh"],
  value: (i: number) => number,
  i: number,
  radius: number
) {
  const own = value(i),
    queue: number[] = [i],
    seen = new Set<number>([i]), // hpc-exempt: a window of a few dozen cells around one cone
    around = new Int32Array(mesh.stride);
  for (let head = 0; head < queue.length; head++) {
    const m = neighborsOf(mesh, queue[head], around);
    for (let k = 0; k < m; k++) {
      const j = around[k];
      if (seen.has(j) || distance(mesh, i, j) > radius) continue;
      seen.add(j);
      queue.push(j);
      const other = value(j);
      if (other > own || (other === own && j < i)) return false;
    }
  }
  return true;
}
