import { potentialEvaporation } from "../canonry/ecologyEnvironment";
import { clamp, type RefinementState } from "./state";

export function regionalPrecipitation(state: RefinementState, i: number) {
  const c = state.surface.channels;
  return (c.rainfall?.get(i) ?? 0) + (c.snowfall?.get(i) ?? 0);
}
/** Existing physical ecology's aridity index; column humidity is an atmospheric input. */
export function regionalMoisture(state: RefinementState, i: number) {
  return clamp(
    regionalPrecipitation(state, i) /
      potentialEvaporation(state.surface.channels.temperature.get(i))
  );
}
export function regionalWetness(state: RefinementState, i: number) {
  const c = state.surface.channels;
  if (c.water.get(i)) return clamp(1 - c.waterDepth.get(i) / 3);
  return (
    clamp(1 - c.slope.get(i) / 0.015) *
    clamp(
      (c.floodplain?.get(i) ?? 0) +
        (c.delta?.get(i) ?? 0) +
        Math.max(0, (regionalMoisture(state, i) - 0.7) * 1.8)
    )
  );
}
