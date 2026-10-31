import { fieldInterpolator, gridPosition } from "@atlas/domain";
import { channel, clamp, spacing, type RefinementState } from "./state";

/** Measure opposing flanks over resolved distances, using the present regional surface. */
export function measureRegionalRelief(state: RefinementState) {
  const g = state.surface,
    at = fieldInterpolator(g, "elevation"),
    relief = channel(state, "localRelief", "metre"),
    valley = channel(state, "valleyDepth", "metre"),
    ridge = g.coverage.scratch("float64", "regional:ridge-height", g.active.length),
    [dx, dy] = spacing(g),
    radius = Math.max(dx * 2, dy * 2, state.parentSpan * 0.45),
    [w, s, e, n] = g.bounds;
  for (let i = 0; i < g.active.length; i++) {
    const p = gridPosition(g, i),
      own = g.channels.elevation.get(i),
      ring = Array.from({ length: 16 }, (_, k) => {
        const angle = (k * Math.PI) / 8;
        return at({
          x: clamp(p.x + Math.cos(angle) * radius, w, e),
          y: clamp(p.y + Math.sin(angle) * radius, s, n),
          z: 0,
        });
      });
    let depth = 0,
      rise = 0;
    for (let k = 0; k < 8; k++) {
      depth = Math.max(depth, Math.min(ring[k], ring[k + 8]) - own);
      rise = Math.max(rise, own - Math.max(ring[k], ring[k + 8]));
    }
    relief.set(i, Math.max(own, ...ring) - Math.min(own, ...ring));
    valley.set(i, depth);
    ridge.set(i, rise);
  }
  return ridge;
}
