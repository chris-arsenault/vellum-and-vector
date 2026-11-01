import { potentialEvaporation } from "../canonry/ecologyEnvironment";
import { channel, clamp, naturalChannel, type RegionalState } from "./state";
import { gradient } from "./relief";

/**
 * Local conditions on the developed relief. Each round derives the shared climate channels
 * from their captured copies: the lapse of new height, exposure to the captured wind, soil
 * gained from deposition. Magic's heat and drying sit on top as tracked contributions, so a
 * second evaluation changes what changed and nothing else.
 */
export function respondClimate(state: RegionalState) {
  const g = state.surface,
    temperature = naturalChannel(state, "temperature", "celsius", 15),
    moisture = naturalChannel(state, "moisture", "ratio", 0.5),
    rain = naturalChannel(state, "rainfall", "metre/year", 0.8),
    runoff = naturalChannel(state, "runoff", "metre/year", 0.4),
    soil = naturalChannel(state, "soilDepth", "metre", 0.6),
    c = g.channels,
    natural = channel(state, "naturalTemperature", "celsius"),
    applied = state.contributions,
    windX = c.windEast,
    windY = c.windNorth;
  if (!state.input.domains.includes("physical")) {
    for (let i = 0; i < g.active.length; i++) natural.set(i, c.temperature.get(i));
    return;
  }
  for (let i = 0; i < g.active.length; i++) {
    const delta = c.elevation.get(i) - state.inheritedHeight.get(i),
      { gx, gy } = gradient(state, i),
      exposure = gx * (windX?.get(i) ?? 1) + gy * (windY?.get(i) ?? 0),
      rainFactor = 1 + 0.35 * Math.tanh(exposure / 0.01),
      cooled = temperature.get(i) - delta * 0.0065;
    natural.set(i, cooled);
    c.temperature.set(i, cooled + applied.appliedTo("temperature", i));
    c.rainfall.set(i, Math.max(0, rain.get(i) * rainFactor + applied.appliedTo("rainfall", i)));
    c.moisture.set(
      i,
      clamp(moisture.get(i) * rainFactor - delta / 10000 + applied.appliedTo("moisture", i))
    );
    c.soilDepth.set(
      i,
      Math.max(
        0.02,
        soil.get(i) + (c.sediment?.get(i) ?? 0) * 0.3 + applied.appliedTo("soilDepth", i)
      )
    );
    // Retain the captured runoff regime; exposure changes its local precipitation supply.
    c.runoff.set(i, Math.max(0, runoff.get(i) * rainFactor + applied.appliedTo("runoff", i)));
  }
}

export function regionalPrecipitation(state: RegionalState, i: number) {
  const c = state.surface.channels;
  return (c.rainfall?.get(i) ?? 0) + (c.snowfall?.get(i) ?? 0);
}
/** Existing physical ecology's aridity index; column humidity is an atmospheric input. */
export function regionalMoisture(state: RegionalState, i: number) {
  return clamp(
    regionalPrecipitation(state, i) /
      potentialEvaporation(state.surface.channels.temperature.get(i))
  );
}
export function regionalWetness(state: RegionalState, i: number) {
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
