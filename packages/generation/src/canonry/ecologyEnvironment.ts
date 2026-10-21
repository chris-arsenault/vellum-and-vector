import { biomeCode as B } from "@atlas/domain";
import type { PhysicalField } from "./field";

export const unit = (value: number) => Math.max(0, Math.min(1, value));
/** Wind speed relative to a 7 m/s reference; maps before atmospheric flow use the reference. */
export const windStrength = (map: PhysicalField, i: number) =>
  map.WindSpeed[i] > 0 ? map.WindSpeed[i] / 7 : 1;
export const approach = (value: number, target: number, years: number, time: number) =>
  target + (value - target) * Math.exp(-years / time);
export interface EcologyForcing {
  growth: number;
  fire: number;
  preservation: number;
  productivity: number;
  grazing: number;
  seasonality: number;
  migration: number;
  recovery: number;
  fireRegime: number;
  alteration: number;
  coldTolerance: number;
  droughtTolerance: number;
  toxicity: number;
  dispersal: number;
}
export const neutralEcology: EcologyForcing = {
  growth: 0,
  fire: 0,
  preservation: 0,
  productivity: 1,
  grazing: 1,
  seasonality: 0.3,
  migration: 1,
  recovery: 1,
  fireRegime: 1,
  alteration: 0,
  coldTolerance: 0,
  droughtTolerance: 0,
  toxicity: 0,
  dispersal: 0,
};
/** Potential evaporation in m/year at a mean temperature in °C, never below 0.25. */
export const potentialEvaporation = (celsius: number) => Math.max(0.25, 0.3 + 0.045 * celsius);
export function environment(map: PhysicalField, i: number, forcing = neutralEcology) {
  const temperature = map.Temperature[i] / 10 - 30;
  const depth = map.WaterDepths[i] / 1024;
  const water = map.WaterKindCodes[i];
  const frozen = map.IceThickness[i] > 1;
  const warmth = unit((temperature + 8) / 18) * unit((52 - temperature) / 18);
  const rain = (map.Rainfall[i] + map.Snowfall[i]) / 1000;
  // Plant water is the aridity index: precipitation over evaporative demand,
  // about 1.4 m/year at 25 °C. Column humidity is not surface humidity: heavy
  // rainout drains the column exactly where plants have most water.
  const moisture = Math.min(1, rain / potentialEvaporation(temperature));
  // Climate supplies each cell's seasonal half-range; the epoch's seasonality
  // scales it, with the neutral 0.3 leaving it unchanged. Before climate has
  // run, the former uniform 7.5 °C half-range at neutral seasonality applies.
  const range =
    map.Seasonality[i] > 0
      ? (map.Seasonality[i] * forcing.seasonality) / neutralEcology.seasonality
      : forcing.seasonality * 25;
  const summer = temperature + range;
  const winter = temperature - range;
  const drought = unit(1 - moisture * (1 - forcing.seasonality * 0.55) - map.SoilWater[i]);
  const flat = unit(1 - map.Slope[i] / 0.015);
  const drainage = unit((map.DrainageElevations[i] - map.Elevation[i]) / (3 * 1024));
  const flood = unit(map.FloodplainIntensity[i] / 1000 + map.DeltaIntensity[i] / 1000);
  const wetness = water
    ? unit(1 - depth / 3)
    : flat * unit(drainage + flood + (moisture - 0.7) * 1.8);
  const submerged = water !== 0 && (water === 1 || depth > 1.5);
  return {
    temperature,
    depth,
    water,
    frozen,
    warmth,
    moisture,
    wetness,
    submerged,
    summer,
    winter,
    drought,
  };
}
export type EcologyEnvironment = ReturnType<typeof environment>;
export function classifyBiome(map: PhysicalField, i: number, env = environment(map, i)) {
  if (env.frozen) return B("Ice");
  if (env.water === 1) return B("Ocean");
  if (env.submerged) return B("Freshwater");
  if (map.AlteredCover[i] + map.AlteredSaplings[i] > 0.2)
    return B(env.wetness > 0.5 ? "Altered wetland" : "Altered woodland");
  if (env.wetness > 0.5) return B(map.TreeCover[i] > 0.2 ? "Swamp" : "Marsh");
  if (env.temperature < 2) return B("Tundra");
  return coverBiome(map, i, env);
}
function coverBiome(map: PhysicalField, i: number, env: EcologyEnvironment) {
  const trees = map.TreeCover[i],
    cover = trees + map.GrassCover[i] + map.WetlandCover[i];
  if (cover < 0.12) return B(env.moisture < 0.25 ? "Desert" : "Barren");
  if (trees < 0.15) return B("Grassland");
  if (trees < 0.4) return B(env.temperature > 18 ? "Savanna" : "Woodland");
  if (map.ConiferCover[i] > map.BroadleafCover[i] || env.temperature < 8) return B("Boreal forest");
  return B(env.temperature > 22 && env.moisture > 0.7 ? "Rainforest" : "Temperate forest");
}
