import { fieldInterpolator, gridPosition, KeyedHeap } from "@atlas/domain";
import { fractalNoise } from "../canonry/noise";
import {
  clamp,
  gaussianBlur,
  gridNeighbors,
  onFrameEdge,
  regionalComponents,
  resolvesRegionalComponent,
  spacing,
  type RegionalState,
} from "./state";

/** Horizontal displacement varies the parent's blocky patch edges without serrating heights. */
const displacementShare = 0.18;
/** Smoothing radius, as a share of the parent sample span, removing the parent's patch creases. */
const baseSmoothing = 0.35;
/** Sea floor below this depth keeps its sampled value; shallower water is smoothed with the shore. */
const shelfDepth = 30;
/** Depth distinguishing a captured closed basin (a desert pan) from sampling roughness. */
const capturedBasinDepth = 20;

/** Sample the parent surface with a gentle displacement, then smooth its interpolation creases. */
export function smoothedBase(state: RegionalState, datum: number) {
  const g = state.surface,
    n = g.active.length,
    [dx, dy] = spacing(g),
    at = fieldInterpolator({ ...g, channels: { elevation: state.inheritedHeight } }, "elevation"),
    [w, s, e, nn] = g.bounds,
    sample = (x: number, y: number) => at({ x: clamp(x, w, e), y: clamp(y, s, nn), z: 0 }),
    wavelength = Math.max(state.parentSpan, Math.max(dx, dy) * 4),
    sampled = new Float64Array(n),
    clamped = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = gridPosition(g, i),
      warpX = fractalNoise(p.x, p.y, state.input.seed ^ 0x51a3, wavelength * 2, 2),
      warpY = fractalNoise(p.x, p.y, state.input.seed ^ 0x7c4b, wavelength * 2, 2);
    sampled[i] = sample(
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

/** Water below the datum joined to the captured ocean or an open frame edge. */
export function connectedSea(state: RegionalState, height: Float64Array, datum: number) {
  const g = state.surface,
    n = height.length,
    sea = new Uint8Array(n),
    queue = new Int32Array(n),
    around = new Int32Array(8);
  let write = 0;
  for (let i = 0; i < n; i++)
    if (height[i] <= datum && (onFrameEdge(g, i) || g.channels.water?.get(i) === 1)) {
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
  const g = state.surface,
    n = base.length,
    sink = new Uint8Array(n),
    filled = floodLevels(g.width, g.height, base, (i) => Boolean(sea[i]) || onFrameEdge(g, i)),
    depth = new Float64Array(n);
  for (let i = 0; i < n; i++) depth[i] = sea[i] || lake[i] >= 0 ? 0 : filled[i] - base[i];
  regionalComponents(
    g,
    (i) => depth[i] > 1e-3,
    (members) => {
      let deepest = 0,
        lowest = members[0];
      for (const i of members) {
        deepest = Math.max(deepest, depth[i]);
        if (base[i] < base[lowest]) lowest = i;
      }
      // The bowl's lowest cell is its sink; the rest of the bowl drains to it.
      if (deepest >= capturedBasinDepth && resolvesRegionalComponent(g, members)) sink[lowest] = 1;
    }
  );
  return sink;
}

/** Priority-flood fill levels from the given outlets: the spill level over each cell. */
export function floodLevels(
  width: number,
  height: number,
  values: Float64Array,
  outlet: (i: number) => boolean
) {
  const n = values.length,
    filled = new Float64Array(n),
    seen = new Uint8Array(n),
    heap = new KeyedHeap(),
    around = new Int32Array(8);
  filled.set(values);
  for (let i = 0; i < n; i++)
    if (outlet(i)) {
      seen[i] = 1;
      heap.push(i, values[i]);
    }
  while (heap.size) {
    const i = heap.pop(),
      m = gridNeighbors(width, height, i, around);
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
