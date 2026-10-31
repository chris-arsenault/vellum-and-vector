import { fieldInterpolator, gridPosition } from "@atlas/domain";
import { drainageRoutes } from "./drainage";
import {
  clamp,
  regionalComponents,
  resolvesRegionalComponent,
  type RefinementState,
} from "./state";

/** Depth distinguishes a newly developed basin from small surface roughness. */
const newBasinDepth = 20;
const basinReliefShare = 0.1;

/** Capture local relief and closed basins as initial conditions, never height constraints. */
export function regionalTerrainContext(state: RefinementState) {
  const g = state.surface,
    filled = g.coverage.scratch("float64", "regional:captured-spill", g.active.length),
    basin = g.coverage.scratch("uint8", "regional:captured-basins", g.active.length),
    relief = g.coverage.scratch("float64", "regional:relief", g.active.length),
    graph = drainageRoutes(state, state.inheritedHeight, filled),
    at = inheritedSampler(state);
  for (let i = 0; i < g.active.length; i++) {
    const p = gridPosition(g, i);
    let low = state.inheritedHeight.get(i),
      high = low;
    for (let k = 0; k < 8; k++) {
      const angle = (k * Math.PI) / 4,
        h = at(p.x + Math.cos(angle) * state.parentSpan, p.y + Math.sin(angle) * state.parentSpan);
      low = Math.min(low, h);
      high = Math.max(high, h);
    }
    relief.set(i, high - low);
    basin.set(i, Number(filled.get(i) - state.inheritedHeight.get(i) > 2));
  }
  for (const band of [filled, graph.receiver, graph.order]) g.coverage.release(band);
  state.terrain = { basin, relief };
}

export function inheritedSampler(state: RefinementState) {
  const g = state.surface,
    at = fieldInterpolator({ ...g, channels: { elevation: state.inheritedHeight } }, "elevation"),
    [w, s, e, n] = g.bounds;
  return (x: number, y: number) => at({ x: clamp(x, w, e), y: clamp(y, s, n), z: 0 });
}

/** Redistribute small new pits; substantial captured basins can still hold lakes. */
export function settleRegionalPits(state: RefinementState) {
  if (!state.terrain) return;
  const g = state.surface,
    height = g.channels.elevation,
    filled = g.coverage.scratch("float64", "regional:surface-spill", height.length),
    graph = drainageRoutes(state, height, filled),
    basins = supportedBasins(state, filled);
  for (let i = 0; i < height.length; i++) {
    if (basins.get(i)) continue;
    const deposit = Math.max(0, filled.get(i) - height.get(i));
    height.add(i, deposit);
    g.channels.sediment?.add(i, deposit);
  }
  for (const band of [filled, graph.receiver, graph.order, basins]) g.coverage.release(band);
}

function supportedBasins(state: RefinementState, filled: import("@atlas/domain").Band) {
  const g = state.surface,
    supported = g.coverage.scratch("uint8", "regional:developed-basins", g.active.length);
  regionalComponents(
    g,
    (i) => filled.get(i) - g.channels.elevation.get(i) > 2,
    (members) => {
      let captured = false,
        depth = 0,
        relief = 0;
      for (const i of members) {
        captured ||= Boolean(state.terrain!.basin.get(i));
        depth = Math.max(depth, filled.get(i) - g.channels.elevation.get(i));
        relief += state.terrain!.relief.get(i);
      }
      const developed =
        depth >= Math.max(newBasinDepth, (relief / members.length) * basinReliefShare);
      if (resolvesRegionalComponent(g, members) && (captured || developed))
        for (const i of members) supported.set(i, 1);
    }
  );
  return supported;
}
