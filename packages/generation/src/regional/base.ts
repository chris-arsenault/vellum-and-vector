import { KeyedHeap, MapScale } from "@atlas/domain";
import { fractalNoise } from "../world/noise";
import { physicalSampler } from "../world/physicalMetric";
import type { PhysicalMesh } from "../world/mesh";
import {
  components,
  frameEdge,
  isContent,
  neighborsOf,
  regionalSpan,
  resolvesComponent,
  smoothOverLength,
} from "./lattice";
import { clamp, type RegionalState } from "./state";

/** Horizontal displacement varies the parent's blocky patch edges without serrating heights. */
const displacementShare = 0.18;
/**
 * Smoothing radius, as a share of the parent sample span: enough to round the parent's patch
 * creases, small enough that a valley floor the parent sampled keeps most of its depth, so
 * the base meets the inherited exterior closely along the frame edge.
 */
export const baseSmoothing = 0.15;
/** Sea floor below this depth keeps its sampled value; shallower water is smoothed with the shore. */
// length-unit: fraction
const shelfDepth = 0.0000075;
/** Depth distinguishing a captured closed basin (a desert pan) from sampling roughness. */
// length-unit: fraction
const capturedBasinDepth = 0.000005;

/**
 * Sample the captured surface (metres above the datum) with a gentle displacement, then
 * smooth its interpolation creases over a share of the parent span.
 */
export function smoothedBase(state: RegionalState, datum: number) {
  const map = state.physical.map,
    mesh = map.mesh,
    n = mesh.count,
    inherited = state.regional.inheritedHeight,
    at = physicalSampler(mesh, (i) => MapScale.metres(inherited.get(i), "native") - datum),
    [w, s, e, nn] = mesh.bounds,
    sample = (x: number, y: number) => at(clamp(x, w, e), clamp(y, s, nn)),
    wavelength = map.scale.supported(state.regional.parentSpan, 4),
    sampled = new Float64Array(n),
    clamped = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = mesh.x(i),
      y = mesh.y(i),
      px = x + mesh.origin[0],
      py = y + mesh.origin[1],
      warpX = fractalNoise(px, py, state.regional.input.seed ^ 0x51a3, wavelength * 2, 2),
      warpY = fractalNoise(px, py, state.regional.input.seed ^ 0x7c4b, wavelength * 2, 2);
    sampled[i] = sample(
      x + warpX * wavelength * displacementShare,
      y + warpY * wavelength * displacementShare
    );
    clamped[i] = Math.max(sampled[i], -map.scale.length(shelfDepth));
  }
  const reach = state.regional.parentSpan * baseSmoothing;
  smoothOverLength(state, clamped, reach);
  // The sea floor is smoothed on its own so deep water keeps its depth without the
  // parent's patch creases, and never pulls the shore down with it.
  smoothOverLength(state, sampled, reach);
  for (let i = 0; i < n; i++) if (clamped[i] < 0) clamped[i] = Math.min(clamped[i], sampled[i]);
  return clamped;
}

/**
 * Water at or below the datum joined to the captured ocean, the inherited exterior or the
 * lattice edge. Heights are metres above the datum.
 */
export function connectedSea(state: RegionalState, height: Float64Array) {
  const map = state.physical.map,
    mesh = map.mesh,
    n = height.length,
    sea = new Uint8Array(n),
    queue = new Int32Array(n),
    around = new Int32Array(mesh.stride);
  let write = 0;
  for (let i = 0; i < n; i++)
    if (
      height[i] <= 0 &&
      (!isContent(mesh, i) || mesh.boundary(i) || map.WaterKindCodes.get(i) === 1)
    ) {
      sea[i] = 1;
      queue[write++] = i;
    }
  for (let read = 0; read < write; read++) {
    const m = neighborsOf(mesh, queue[read], around);
    for (let k = 0; k < m; k++) {
      const j = around[k];
      if (sea[j] || height[j] > 0) continue;
      sea[j] = 1;
      queue[write++] = j;
    }
  }
  return sea;
}

/**
 * A closed depression the parent itself holds (a desert basin, a dry pan) is a captured fact:
 * its floor is a root of the network, so the country drains into it, and whether it holds
 * water follows its supply. Filling it flat would invent a plain.
 */
export function capturedSinks(
  state: RegionalState,
  base: Float64Array,
  sea: Uint8Array,
  lake: Int32Array
) {
  // The frame edge drains at its own height: the exterior beyond it is read at the parent's
  // coarser cells, which cannot carry a valley narrower than themselves across the edge.
  const mesh = state.physical.map.mesh,
    n = base.length,
    sink = new Uint8Array(n),
    bowl = new Uint8Array(n),
    filled = floodLevels(
      mesh,
      base,
      (i) => Boolean(sea[i]) || mesh.boundary(i) || frameEdge(mesh, i)
    ),
    depth = new Float64Array(n);
  for (let i = 0; i < n; i++) depth[i] = sea[i] || lake[i] >= 0 ? 0 : filled[i] - base[i];
  components(
    mesh,
    (i) => depth[i] > 1e-3,
    (members) => {
      let deepest = 0,
        lowest = members[0];
      for (const i of members) {
        deepest = Math.max(deepest, depth[i]);
        if (base[i] < base[lowest]) lowest = i;
      }
      // The bowl's lowest cell is its sink; the rest of the bowl drains to it, and the whole
      // bowl may lie below its spill, so the routing can stand water in it.
      if (
        deepest < state.physical.map.scale.length(capturedBasinDepth) ||
        !resolvesComponent(mesh, members, regionalSpan(state))
      )
        return;
      sink[lowest] = 1;
      for (const i of members) bowl[i] = 1;
    }
  );
  return { sink, bowl };
}

/** Water deeper than this (m) over a spill-filled floor is standing water worth a stage. */
export const poolDepth = (scale: MapScale) => scale.length(0.0000005);
/** The fewest cells a pool spans before the map holds it as a lake. */
export const lakeCells = 3;

/**
 * Hollows of the derived surface that can hold a lake: at least `poolDepth` below their spill
 * and `lakeCells` across. A slide that dams a valley or a fan that blocks a tributary leaves
 * such a hollow; the relief keeps it rather than draining it, and the routing stands water in
 * it as far as the supply allows. Shallower or smaller pits are the derivation's noise.
 */
export function lakeHollows(state: RegionalState, h: Float64Array, sea: Uint8Array) {
  const mesh = state.physical.map.mesh,
    held = new Uint8Array(h.length),
    filled = floodLevels(mesh, h, (i) => Boolean(sea[i]) || mesh.boundary(i) || frameEdge(mesh, i));
  components(
    mesh,
    (i) => !sea[i] && filled[i] - h[i] > 1e-3,
    (members) => {
      if (members.length < lakeCells) return;
      if (!members.some((i) => filled[i] - h[i] >= poolDepth(state.physical.map.scale))) return;
      for (const i of members) held[i] = 1;
    }
  );
  return held;
}

/** Priority-flood fill levels from the given outlets: the spill level over each cell. */
export function floodLevels(
  mesh: PhysicalMesh,
  values: Float64Array,
  outlet: (i: number) => boolean
) {
  const n = values.length,
    filled = new Float64Array(n),
    seen = new Uint8Array(n),
    heap = new KeyedHeap(),
    around = new Int32Array(mesh.stride);
  filled.set(values);
  for (let i = 0; i < n; i++)
    if (outlet(i)) {
      seen[i] = 1;
      heap.push(i, values[i]);
    }
  while (heap.size) {
    const i = heap.pop(),
      m = neighborsOf(mesh, i, around);
    for (let k = 0; k < m; k++) {
      const j = around[k];
      if (seen[j]) continue;
      seen[j] = 1;
      filled[j] = Math.max(values[j], filled[i]);
      heap.push(j, filled[j]);
    }
  }
  return filled;
}
