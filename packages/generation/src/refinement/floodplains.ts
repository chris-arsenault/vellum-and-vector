import { channel, clamp, distance, neighbors, spacing, type RefinementState } from "./state";

/** Floodplain half-width per square root of mean discharge, in metres. */
const floodWidth = 80;
/** Only low-gradient channel margins retain floodwater. */
const floodplainGradient = 0.012;

/** Resolve local channel margins rather than painting an inherited coarse floodplain everywhere. */
export function regionalFloodplains(state: RefinementState) {
  const g = state.surface,
    floodplain = channel(state, "floodplain", "ratio").fill(0),
    delta = channel(state, "delta", "ratio").fill(0),
    [dx, dy] = spacing(g),
    span = Math.sqrt(dx * dy);
  for (let i = 0; i < g.active.length; i++) {
    if (g.channels.riverOrder.get(i) <= 0 || g.channels.water.get(i) !== 0) continue;
    const width = Math.sqrt(g.channels.flow.get(i)) * floodWidth,
      coast = [...neighbors(g, i)].some((j) => g.channels.water.get(j) === 1);
    for (const j of [i, ...neighbors(g, i)]) {
      if (g.channels.water.get(j) !== 0) continue;
      const flat = clamp(1 - g.channels.slope.get(j) / floodplainGradient),
        covered = clamp((width - distance(g, i, j)) / span) * flat;
      floodplain.set(j, Math.max(floodplain.get(j), covered));
      if (coast) delta.set(j, Math.max(delta.get(j), covered));
    }
  }
}
