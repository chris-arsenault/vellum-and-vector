import { seasonality, snowShare } from "../canonry/climate";
import { potentialEvaporation } from "../canonry/ecologyEnvironment";
import { latitudeAt } from "../canonry/latitude";
import { releaseWorking } from "../canonry/physicalNumerics";
import { deflectWind, windTerrain } from "../canonry/windTerrain";
import { capturedCelsius, magicHeat } from "./glacial";
import { isContent } from "./lattice";
import { heightGradients } from "./relief";
import { clamp, naturalBand, type RegionalState } from "./state";

/** Lapse of temperature with height (°C/m). */
const lapse = 0.0065;
/** Warming of a fully sun-exposed slope, and cooling of a fully pooled floor (°C). */
const aspectTemperature = 3,
  poolingTemperature = 4;

/**
 * Local conditions on the developed relief. Each round derives the shared climate bands from
 * their captured copies: the lapse of new height, the slope's exposure to the sun, the cold
 * pooled in hollows, exposure to the captured wind, soil gained from deposition. Magic's heat
 * and drying sit on top as the workspace's own replaced contribution and the ledger's
 * totals, so a second evaluation changes what changed and nothing else. Precipitation is
 * re-split into rain and snow by the new temperature with the world's own rule. Bands keep
 * their native units: temperature in tenths of a degree above -30 °C, rainfall, snowfall and
 * runoff in millimetres a year, moisture per mille, soil in metres.
 */
export function respondClimate(state: RegionalState) {
  const map = state.physical.map,
    mesh = map.mesh,
    moisture = naturalBand(state, "Moisture"),
    soil = naturalBand(state, "SoilDepth"),
    runoff = naturalBand(state, "Runoff"),
    applied = state.regional.contributions;
  if (!state.regional.input.domains.includes("physical")) return;
  deflectCapturedWind(state);
  const { gx, gy } = heightGradients(state);
  for (let i = 0; i < mesh.count; i++) {
    if (!isContent(mesh, i)) continue;
    const delta = (map.Elevation.get(i) - state.regional.inheritedHeight.get(i)) / 1024,
      exposure = (gx[i] * map.WindX.get(i) + gy[i] * map.WindY.get(i)) / 1000,
      rainFactor = 1 + 0.35 * Math.tanh(exposure / 0.01);
    map.Temperature.set(i, nativeTemperature(localTemperature(state, i, delta)));
    splitPrecipitation(state, i, rainFactor);
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
    // The captured runoff regime is the budget; exposure changes its supply and the developed
    // cover changes what reaches the channels (plan: runoff loss structure).
    map.Runoff.set(
      i,
      Math.max(
        0,
        Math.round(
          runoff.get(i) * rainFactor * coverRetention(state, i) +
            map.GlacialMeltwater.get(i) +
            applied.appliedTo("Runoff", i)
        )
      )
    );
  }
}

/** Captured temperature lapsed by the height gained, with aspect, pooling, magic and the ledger (°C). */
function localTemperature(state: RegionalState, i: number, delta: number) {
  const media = state.regional.media,
    sun = media ? media.insolation[i] * aspectTemperature : 0,
    pooled = media ? media.pooling[i] * poolingTemperature : 0;
  return (
    capturedCelsius(state, i) -
    delta * lapse +
    sun -
    pooled +
    magicHeat(state, i) +
    state.regional.contributions.appliedTo("Temperature", i) / 10
  );
}
const nativeTemperature = (celsius: number) => Math.round(clamp((celsius + 30) * 10, 0, 1000));

/**
 * The captured wind deflected by the developed relief with the world's own rule (valley
 * channelling, lee turning), written each round from the captured direction so a change in
 * relief updates the wind rather than turning it further each round.
 */
function deflectCapturedWind(state: RegionalState) {
  const map = state.physical.map,
    mesh = map.mesh,
    profile = state.physical.profile,
    windX = naturalBand(state, "WindX"),
    windY = naturalBand(state, "WindY"),
    terrain = windTerrain(map, profile);
  for (let i = 0; i < mesh.count; i++) {
    if (!isContent(mesh, i)) continue;
    const x = windX.get(i) / 1000,
      y = windY.get(i) / 1000,
      speed = Math.hypot(x, y);
    if (speed === 0) continue;
    const [dx, dy] = deflectWind(terrain, profile, i, x / speed, y / speed);
    map.WindX.set(i, Math.round(dx * speed * 1000));
    map.WindY.set(i, Math.round(dy * speed * 1000));
  }
  releaseWorking(map, terrain.terrain, terrain.gradientX, terrain.gradientY, terrain.height);
}

/** Share of runoff a full canopy intercepts, and a full wetland holds, beyond the captured cover. */
const canopyInterception = 0.3,
  wetlandHold = 0.3;
/**
 * What the developed cover does to the captured runoff: trees grown since the capture
 * intercept, wetland holds, cleared ground sheds more. Bounded, so the cover shifts the
 * budget and never replaces it.
 */
function coverRetention(state: RegionalState, i: number) {
  const map = state.physical.map,
    trees = map.TreeCover.get(i) - naturalBand(state, "TreeCover").get(i),
    wetland = map.WetlandCover.get(i) - naturalBand(state, "WetlandCover").get(i);
  return clamp(1 - canopyInterception * trees - wetlandHold * wetland, 0.4, 1.5);
}

/**
 * The captured precipitation, changed by exposure and the ledger, falls as snow for the share
 * of the year the world's rule gives at the new temperature and this latitude's seasonal
 * range (continentality from the distance to the sea).
 */
function splitPrecipitation(state: RegionalState, i: number, rainFactor: number) {
  const map = state.physical.map,
    profile = state.physical.profile,
    applied = state.regional.contributions,
    total = Math.max(
      0,
      (naturalBand(state, "Rainfall").get(i) + naturalBand(state, "Snowfall").get(i)) * rainFactor +
        applied.appliedTo("Rainfall", i) +
        applied.appliedTo("Snowfall", i)
    ),
    distance = map.OceanDistance.get(i),
    continentality =
      map.WaterKindCodes.get(i) === 1 || distance < 0
        ? 0
        : distance / profile.ContinentalityDistance,
    halfRange = seasonality(profile, latitudeAt(profile, map, i), continentality);
  map.Seasonality.set(i, halfRange);
  const snow = Math.round(
    (total * snowShare(profile, map.Temperature.get(i), halfRange * 10)) / 1000
  );
  map.Snowfall.set(i, snow);
  map.Rainfall.set(i, Math.round(total) - snow);
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
/** Share of the topographic wetness that reaches the ground's water supply. */
const wetnessSupply = 0.3;
/**
 * The ground's water supply as the existing physical ecology's aridity index (precipitation
 * over potential evaporation), raised where the ground gathers the water of the slopes
 * above it (the wetness medium): soil water in a valley floor outlasts the rain.
 */
export function regionalMoisture(state: RegionalState, i: number) {
  const climate = regionalPrecipitation(state, i) / potentialEvaporation(celsius(state, i)),
    gathered = state.regional.media ? state.regional.media.wetness[i] * wetnessSupply : 0;
  return clamp(climate + gathered * Math.min(1, climate));
}
/**
 * How wet the ground stays: standing water by its depth; land by the topographic wetness
 * medium where the round has derived it, scaled by the climate's water (a dry upland's
 * wettest hollow is not a marsh) and raised where the climate is humid. Before any water
 * has been routed, the captured floodplain and delta intensities stand in.
 */
export function regionalWetness(state: RegionalState, i: number) {
  const map = state.physical.map,
    media = state.regional.media,
    moisture = regionalMoisture(state, i);
  if (map.WaterKindCodes.get(i)) return clamp(1 - map.WaterDepths.get(i) / 1024 / 3);
  const humid = Math.max(0, (moisture - 0.7) * 1.8),
    // Water does not stand on a slope, however much arrives: the frame-relative index is
    // damped by the ground's own gradient.
    level = clamp(1 - map.Slope.get(i) / 0.03);
  if (media) return clamp(media.wetness[i] * 0.8 * clamp(moisture / 0.4) + humid) * level;
  return (
    clamp(1 - map.Slope.get(i) / 0.015) *
    clamp(map.FloodplainIntensity.get(i) / 1000 + map.DeltaIntensity.get(i) / 1000 + humid)
  );
}
