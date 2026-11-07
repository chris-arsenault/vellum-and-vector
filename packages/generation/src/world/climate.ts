import { respond } from "../coupling/answers";
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { PhysicalProfile } from "./profile";
import { clamp, round, toUnits, truncate } from "./math";
import { groundOf } from "../rock/ground";
import { surfaceKind } from "../rock/groundQueries";
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
    const latitude = latitudeAt(p, map, i),
      sea = map.WaterKindCodes.get(i) === 1,
      oceanDistance = map.OceanDistance.get(i);
    const lapse = truncate(
      (toUnits(Math.max(0, map.Elevation.get(i) - map.EffectiveSeaLevel)) *
        p.ElevationTemperatureLapse) /
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
    // Only heat above the surface threshold (vents, active volcanoes) warms the air.
    const heat = truncate(
      (Math.max(0, map.Geothermal.get(i) - p.GeothermalSurfaceThreshold) *
        p.GeothermalTemperatureStrength) /
        1000
    );
    const current = truncate(
      (truncate((map.OceanCurrentHeat.get(i) * map.OceanCurrentStrength.get(i)) / 1000) *
        p.OceanCurrentTemperatureStrength) /
        1000
    );
    map.Temperature.set(
      i,
      clamp(
        p.TemperatureBaseline +
          c.TemperatureOffset +
          insolationTemperature(p, latitude) +
          (sea ? map.SeaSurfaceAnomaly.get(i) : 0) -
          lapse +
          heat +
          current +
          map.Warmth.get(i) +
          map.ExternalHeatForcing.get(i) -
          round(map.FogForcing.get(i) * p.FogCooling) -
          round(map.Evapotranspiration.get(i) * 15),
        0,
        1000
      )
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
    map.ColumnPrecipitation.set(i, column.precipitation.get(i));
    map.StormTrack.set(i, round(1000 * column.storm.get(i)));
    if (map.WaterKindCodes.get(i) !== 0) {
      map.Moisture.set(i, 1000);
      continue;
    }
    map.Temperature.set(i, clamp(round(map.Temperature.get(i) + column.airHeat.get(i)), 0, 1000));
    map.Seasonality.set(i, seasonality(p, latitudeAt(p, map, i), 1 - column.maritime.get(i)));
    map.Moisture.set(
      i,
      clamp(round((1000 * column.moisture.get(i)) / saturation(p, map.Temperature.get(i))), 0, 1000)
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
    // Fog drip on a coast facing an upwelling band is water the column did not carry.
    // No more falls than the air brought: the column is what limits it.
    const total = Math.max(
      0,
      truncate((p.PrecipitationBaseline + map.ColumnPrecipitation.get(i)) * c.RainfallMultiplier) +
        truncate(map.FogForcing.get(i) * p.FogDrip)
    );
    const snow = snowShare(p, map.Temperature.get(i), map.Seasonality.get(i) * 10);
    const snowfall = truncate((total * snow) / 1000);
    map.Snowfall.set(i, snowfall);
    map.Rainfall.set(i, total - snowfall);
  }
}
/** How much of the water on fully porous rock goes into the ground instead of running off. */
const groundwaterShare = 0.35;
export function runoff(map: PhysicalField, c: PhysicalContext) {
  const p = c.Profile;
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes.get(i) === 1) {
      map.Runoff.set(i, 0);
      continue;
    }
    const temperature = map.Temperature.get(i);
    const melt = clamp(
      truncate(
        ((temperature - (p.SnowTemperatureThreshold - p.SnowTemperatureTransition)) * 1000) /
          p.SnowTemperatureTransition
      ),
      0,
      1000
    );
    const available = Math.max(
      0,
      map.Rainfall.get(i) + truncate((map.Snowfall.get(i) * melt) / 1000)
    );
    const loss = clamp(
      p.RunoffMinimumLossPerMille +
        truncate((temperature * p.RunoffTemperatureLossPerMille) / 1000),
      0,
      1000
    );
    const vegetationLoss = Math.min(
      0.35,
      map.TreeCover.get(i) * 0.22 + map.GrassCover.get(i) * 0.08 + map.WetlandCover.get(i) * 0.12
    );
    const ecologicalLoss = map.EcologyInitialized
      ? Math.min(
          available,
          map.Evapotranspiration.get(i) * 1000 + available * map.Infiltration.get(i) * 0.08
        )
      : available * vegetationLoss;
    // Magical warmth carried down the channel evaporates more of what the channel carries.
    const warmLoss = truncate((available * map.RiverWarmth.get(i) * p.WarmRiverEvaporation) / 1000);
    const evaporation =
      (map.EcologyInitialized
        ? Math.max((available * loss) / 1000, ecologicalLoss)
        : (available * loss) / 1000 + ecologicalLoss) + warmLoss;
    // Wetlands and peat hold water back, so the floods below them are flatter.
    const held = map.EcologyInitialized
      ? Math.min(0.45, 0.3 * map.WetlandCover.get(i) + map.PeatCarbon.get(i) / 60)
      : 0;
    // Porous rock takes water into the ground, so less of it runs off over the surface.
    const seeping = groundOf(map).fold(i, surfaceKind).porosity * groundwaterShare;
    map.Runoff.set(i, truncate(Math.max(0, available - evaporation) * (1 - held) * (1 - seeping)));
  }
}

/** What climate answers of the ground. Temperature is ten native units per degree, freezing at 300. */
const freezing = 300,
  warm = 200,
  frostBand = 100;
respond({
  key: "discharge",
  by: "climate",
  reads: ["Runoff"],
  base: (map, i, { Profile: p }) => map.Runoff.get(i) / p.FluvialReferenceRunoff,
});
respond({
  key: "wetness",
  by: "climate",
  reads: ["Runoff"],
  base: (map, i, { Profile: p }) => map.Runoff.get(i) / (p.FluvialReferenceRunoff * 2),
});
respond({
  key: "warmth",
  by: "climate",
  reads: ["Temperature"],
  base: (map, i) => Math.max(0, map.Temperature.get(i) - freezing) / warm,
});
// Ground that crosses freezing again and again is opened by frost, if it has water to freeze.
respond({
  key: "frost",
  by: "climate",
  reads: ["Temperature", "Rainfall"],
  base: (map, i, { Profile: p }) =>
    clamp(1 - Math.abs(map.Temperature.get(i) - freezing) / frostBand, 0, 1) *
    clamp(map.Rainfall.get(i) / p.FluvialReferenceRunoff, 0, 1),
});
