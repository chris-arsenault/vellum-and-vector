// TemperatureLayer, MoistureLayer, PrecipitationLayer and RunoffLayer, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { PhysicalProfile } from "./profile";
import { clamp, round, toUnits, truncate } from "./math";
import { latitudeAt } from "./latitude";
import { marchAirColumns, saturation } from "./airColumn";
import { beltRainout } from "./belts";

/** Annual-mean insolation departure from the global mean, in native units. */
export function insolationTemperature(p: PhysicalProfile, latitude: number) {
  const s = Math.sin((latitude * Math.PI) / 180);
  return round((-p.InsolationTemperatureRange * (3 * s * s - 1)) / 2);
}
/** Seasonal half-range grows poleward and inland; open ocean stays maritime. */
export function seasonality(p: PhysicalProfile, latitude: number, continentality: number) {
  const s = Math.sin((latitude * Math.PI) / 180);
  return (
    (p.SeasonalityEquator + p.SeasonalityPolar * s * s) *
    (p.MaritimeSeasonality + (1 - p.MaritimeSeasonality) * clamp(continentality, 0, 1))
  );
}
export function temperature(map: PhysicalField, c: PhysicalContext) {
  const p = c.Profile;
  for (let i = 0; i < map.mesh.count; i++) {
    const latitude = latitudeAt(p, map, i);
    const lapse = truncate(
      (toUnits(Math.max(0, map.Elevation[i] - map.EffectiveSeaLevel)) *
        p.ElevationTemperatureLapse) /
        p.ElevationScale
    );
    map.Seasonality[i] = seasonality(
      p,
      latitude,
      map.WaterKindCodes[i] === 1 || map.OceanDistance[i] < 0
        ? 0
        : map.OceanDistance[i] / p.ContinentalityDistance
    );
    // Only heat above the surface threshold (vents, active volcanoes) warms the air.
    const heat = truncate(
      (Math.max(0, map.Geothermal[i] - p.GeothermalSurfaceThreshold) *
        p.GeothermalTemperatureStrength) /
        1000
    );
    const current = truncate(
      (truncate((map.OceanCurrentHeat[i] * map.OceanCurrentStrength[i]) / 1000) *
        p.OceanCurrentTemperatureStrength) /
        1000
    );
    map.Temperature[i] = clamp(
      p.TemperatureBaseline +
        c.TemperatureOffset +
        insolationTemperature(p, latitude) +
        (map.WaterKindCodes[i] === 1 ? map.SeaSurfaceAnomaly[i] : 0) -
        lapse +
        heat +
        current +
        map.Warmth[i] +
        map.ExternalHeatForcing[i] -
        round(map.Evapotranspiration[i] * 15),
      0,
      1000
    );
  }
}
/**
 * March air columns downwind. Land takes the air's carried marine and magical
 * heat, its continentality from how far the air has been from the sea, and
 * relative humidity as moisture; precipitation is retained for the next step.
 */
export function moisture(map: PhysicalField, c: PhysicalContext) {
  const p = c.Profile,
    column = marchAirColumns(map, c, (i) => beltRainout(p, latitudeAt(p, map, i)));
  for (let i = 0; i < map.mesh.count; i++) {
    map.ColumnPrecipitation[i] = column.precipitation[i];
    if (map.WaterKindCodes[i] !== 0) {
      map.Moisture[i] = 1000;
      continue;
    }
    map.Temperature[i] = clamp(round(map.Temperature[i] + column.airHeat[i]), 0, 1000);
    map.Seasonality[i] = seasonality(p, latitudeAt(p, map, i), 1 - column.maritime[i]);
    map.Moisture[i] = clamp(
      round((1000 * column.moisture[i]) / saturation(p, map.Temperature[i])),
      0,
      1000
    );
  }
}
/** Per-mille of the year below the snow threshold for a sinusoidal annual cycle. */
export function snowShare(p: PhysicalProfile, mean: number, halfRange: number) {
  const amplitude = Math.max(halfRange, p.SnowTemperatureTransition / 2);
  const x = (mean - p.SnowTemperatureThreshold) / amplitude;
  return x >= 1 ? 0 : x <= -1 ? 1000 : round((Math.acos(x) / Math.PI) * 1000);
}
export function precipitation(map: PhysicalField, c: PhysicalContext) {
  const p = c.Profile;
  for (let i = 0; i < map.mesh.count; i++) {
    const total = clamp(
      truncate((p.PrecipitationBaseline + map.ColumnPrecipitation[i]) * c.RainfallMultiplier),
      0,
      p.PrecipitationCeiling
    );
    const snow = snowShare(p, map.Temperature[i], map.Seasonality[i] * 10);
    map.Snowfall[i] = truncate((total * snow) / 1000);
    map.Rainfall[i] = total - map.Snowfall[i];
  }
}
export function runoff(map: PhysicalField, c: PhysicalContext) {
  const p = c.Profile;
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes[i] === 1) {
      map.Runoff[i] = 0;
      continue;
    }
    const melt = clamp(
      truncate(
        ((map.Temperature[i] - (p.SnowTemperatureThreshold - p.SnowTemperatureTransition)) * 1000) /
          p.SnowTemperatureTransition
      ),
      0,
      1000
    );
    const available = clamp(
      map.Rainfall[i] + truncate((map.Snowfall[i] * melt) / 1000),
      0,
      p.PrecipitationCeiling
    );
    const loss = clamp(
      p.RunoffMinimumLossPerMille +
        truncate((map.Temperature[i] * p.RunoffTemperatureLossPerMille) / 1000),
      0,
      1000
    );
    const vegetationLoss = Math.min(
      0.35,
      map.TreeCover[i] * 0.22 + map.GrassCover[i] * 0.08 + map.WetlandCover[i] * 0.12
    );
    const ecologicalLoss = map.EcologyInitialized
      ? Math.min(
          available,
          map.Evapotranspiration[i] * 1000 + available * map.Infiltration[i] * 0.08
        )
      : available * vegetationLoss;
    const evaporation = map.EcologyInitialized
      ? Math.max((available * loss) / 1000, ecologicalLoss)
      : (available * loss) / 1000 + ecologicalLoss;
    map.Runoff[i] = truncate(Math.max(0, available - evaporation));
  }
}
