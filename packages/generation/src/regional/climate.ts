import { potentialEvaporation } from "../canonry/ecologyEnvironment";
import { capturedCelsius, magicHeat } from "./glacial";
import { isContent } from "./lattice";
import { heightGradients } from "./relief";
import { clamp, naturalBand, type RegionalState } from "./state";

/** Lapse of temperature with height (°C/m). */
const lapse = 0.0065;

/**
 * Local conditions on the developed relief. Each round derives the shared climate bands from
 * their captured copies: the lapse of new height, exposure to the captured wind, soil gained
 * from deposition. Magic's heat and drying sit on top as the workspace's own replaced
 * contribution and the ledger's totals, so a second evaluation changes what changed and
 * nothing else. Bands keep their native units: temperature in tenths of a degree above
 * -30 °C, rainfall and runoff in millimetres a year, moisture per mille, soil in metres.
 */
export function respondClimate(state: RegionalState) {
  const map = state.physical.map,
    mesh = map.mesh,
    moisture = naturalBand(state, "Moisture"),
    rain = naturalBand(state, "Rainfall"),
    runoff = naturalBand(state, "Runoff"),
    soil = naturalBand(state, "SoilDepth"),
    applied = state.regional.contributions;
  if (!state.regional.input.domains.includes("physical")) return;
  const { gx, gy } = heightGradients(state);
  for (let i = 0; i < mesh.count; i++) {
    if (!isContent(mesh, i)) continue;
    const delta = (map.Elevation.get(i) - state.regional.inheritedHeight.get(i)) / 1024,
      exposure = (gx[i] * map.WindX.get(i) + gy[i] * map.WindY.get(i)) / 1000,
      rainFactor = 1 + 0.35 * Math.tanh(exposure / 0.01),
      cooled = capturedCelsius(state, i) - delta * lapse;
    map.Temperature.set(i, Math.round(clamp((cooled + magicHeat(state, i) + 30) * 10, 0, 1000)));
    map.Rainfall.set(
      i,
      Math.max(0, Math.round(rain.get(i) * rainFactor + applied.appliedTo("Rainfall", i)))
    );
    map.Moisture.set(
      i,
      Math.round(
        clamp(moisture.get(i) * rainFactor - delta / 10 + applied.appliedTo("Moisture", i), 0, 1000)
      )
    );
    map.SoilDepth.set(
      i,
      Math.max(
        0.02,
        soil.get(i) +
          (map.SedimentThickness.get(i) / 1024) * 0.3 +
          applied.appliedTo("SoilDepth", i)
      )
    );
    // Retain the captured runoff regime; exposure changes its local precipitation supply.
    map.Runoff.set(
      i,
      Math.max(0, Math.round(runoff.get(i) * rainFactor + applied.appliedTo("Runoff", i)))
    );
  }
}

/** Present temperature in °C. */
export function celsius(state: RegionalState, i: number) {
  return state.physical.map.Temperature.get(i) / 10 - 30;
}
/** Rain plus snow (m/yr). */
export function regionalPrecipitation(state: RegionalState, i: number) {
  const map = state.physical.map;
  return (map.Rainfall.get(i) + map.Snowfall.get(i)) / 1000;
}
/** Existing physical ecology's aridity index; column humidity is an atmospheric input. */
export function regionalMoisture(state: RegionalState, i: number) {
  return clamp(regionalPrecipitation(state, i) / potentialEvaporation(celsius(state, i)));
}
export function regionalWetness(state: RegionalState, i: number) {
  const map = state.physical.map;
  if (map.WaterKindCodes.get(i)) return clamp(1 - map.WaterDepths.get(i) / 1024 / 3);
  return (
    clamp(1 - map.Slope.get(i) / 0.015) *
    clamp(
      map.FloodplainIntensity.get(i) / 1000 +
        map.DeltaIntensity.get(i) / 1000 +
        Math.max(0, (regionalMoisture(state, i) - 0.7) * 1.8)
    )
  );
}
