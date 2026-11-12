import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { PhysicalProfile } from "./profile";
import { clamp, round, truncate } from "./math";
import { latitudeAt } from "./latitude";
import { marchAirColumns, saturation } from "./airColumn";
import { beltRainout } from "./belts";
import { MapScale } from "@atlas/domain";
import { releaseWorking } from "./physicalNumerics";

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
/** Native temperature loss for a measured altitude change in the atmosphere's dimensional frame. */
export function altitudeTemperature(metres: number, lapse: number, elevationScale: number) {
  return (metres * lapse) / elevationScale;
}
export function temperature(map: PhysicalField, c: PhysicalContext) {
  const p = c.Profile;
  for (let i = 0; i < map.mesh.count; i++) {
    const latitude = latitudeAt(p, map, i),
      sea = map.WaterKindCodes.get(i) === 1,
      oceanDistance = map.OceanDistance.get(i);
    const lapse = altitudeTemperature(
      MapScale.metres(Math.max(0, map.Elevation.get(i) - map.EffectiveSeaLevel), "native"),
      p.ElevationTemperatureLapse,
      p.ElevationScale
    );
    map.Seasonality.set(
      i,
      seasonality(
        p,
        latitude,
        sea || oceanDistance < 0 ? 0 : oceanDistance / p.ContinentalityDistance
      )
    );
    map.Temperature.set(
      i,
      p.TemperatureBaseline +
        c.TemperatureOffset +
        insolationTemperature(p, latitude) +
        climateTemperatureForcing(map, p, i) -
        lapse
    );
  }
}
/** Current environmental contribution in native temperature units, independent of latitude/lapse. */
export function climateTemperatureForcing(map: PhysicalField, p: PhysicalProfile, i: number) {
  const heat = truncate(
      (Math.max(0, map.Geothermal.get(i) - p.GeothermalSurfaceThreshold) *
        p.GeothermalTemperatureStrength) /
        1000
    ),
    current = truncate(
      (truncate((map.OceanCurrentHeat.get(i) * map.OceanCurrentStrength.get(i)) / 1000) *
        p.OceanCurrentTemperatureStrength) /
        1000
    );
  return (
    heat +
    current +
    map.Warmth.get(i) +
    map.ExternalHeatForcing.get(i) +
    (map.WaterKindCodes.get(i) === 1 ? map.SeaSurfaceAnomaly.get(i) : 0) -
    round(map.FogForcing.get(i) * p.FogCooling) -
    round(map.Evapotranspiration.get(i) * 15)
  );
}

/** Condensed marine fog supplies precipitation outside the advected atmospheric column. */
export function fogPrecipitation(fog: number, drip: number) {
  return fog * drip;
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
    map.ColumnPrecipitation.set(i, column.precipitation.get(i));
    map.StormTrack.set(i, round(1000 * column.storm.get(i)));
    if (map.WaterKindCodes.get(i) !== 0) {
      map.Moisture.set(i, 1000);
      continue;
    }
    map.Temperature.set(i, round(map.Temperature.get(i) + column.airHeat.get(i)));
    map.Seasonality.set(i, seasonality(p, latitudeAt(p, map, i), 1 - column.maritime.get(i)));
    map.Moisture.set(
      i,
      clamp(round((1000 * column.moisture.get(i)) / saturation(p, map.Temperature.get(i))), 0, 1000)
    );
  }
  releaseWorking(
    map,
    column.precipitation,
    column.storm,
    column.airHeat,
    column.maritime,
    column.moisture
  );
}
/** Per-mille of the year below the snow threshold for a sinusoidal annual cycle. */
export function snowShare(p: PhysicalProfile, mean: number, halfRange: number) {
  const amplitude = Math.max(halfRange, p.SnowTemperatureTransition / 2);
  const x = (mean - p.SnowTemperatureThreshold) / amplitude;
  return x >= 1 ? 0 : x <= -1 ? 1000 : round((Math.acos(x) / Math.PI) * 1000);
}
/** Convert the share before multiplying so fully snowy precipitation leaves no negative rain. */
export function partitionPrecipitation(total: number, snowPerMille: number) {
  const snowfall = total * (snowPerMille / 1000);
  return { snowfall, rainfall: total - snowfall };
}
export function precipitation(map: PhysicalField, c: PhysicalContext) {
  const p = c.Profile;
  for (let i = 0; i < map.mesh.count; i++) {
    // Fog drip on a coast facing an upwelling band is water the column did not carry.
    // No more falls than the air brought: the column is what limits it.
    const total = Math.max(
      0,
      (p.PrecipitationBaseline + map.ColumnPrecipitation.get(i)) * c.RainfallMultiplier +
        fogPrecipitation(map.FogForcing.get(i), p.FogDrip)
    );
    const snow = snowShare(p, map.Temperature.get(i), map.Seasonality.get(i) * 10);
    const { snowfall, rainfall } = partitionPrecipitation(total, snow);
    map.Snowfall.set(i, snowfall);
    map.Rainfall.set(i, rainfall);
  }
}
