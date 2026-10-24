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
  toxicity: number;
  dispersal: number;
  /** Fire: living processes run faster, 0 to 1. */
  quickening: number;
  /** Aurora: living processes slow and persist, 0 to 1. */
  stillness: number;
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
  toxicity: 0,
  dispersal: 0,
  quickening: 0,
  stillness: 0,
};
/** Potential evaporation in m/year at a mean temperature in °C, never below 0.25. */
export const potentialEvaporation = (celsius: number) => Math.max(0.25, 0.3 + 0.045 * celsius);
export function environment(map: PhysicalField, i: number, forcing = neutralEcology) {
  // A river carrying magical warmth is warmer than its banks and does not freeze.
  const warmth = map.RiverOrders[i] >= 1 ? map.RiverWarmth[i] : 0;
  const temperature = (map.Temperature[i] + warmth) / 10 - 30;
  const depth = map.WaterDepths[i] / 1024;
  const water = map.WaterKindCodes[i];
  const frozen = map.IceThickness[i] > 1 && warmth < 50;
  const warmSeason = unit((temperature + 8) / 18) * unit((52 - temperature) / 18);
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
    warmth: warmSeason,
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
  const magical = magicalBiome(map, i);
  if (magical !== null) return magical;
  if (env.wetness > 0.5) return B(map.TreeCover[i] > 0.2 ? "Swamp" : "Marsh");
  if (env.temperature < 2) return B("Tundra");
  return coverBiome(map, i, env);
}
/**
 * Living landscapes a magic system makes through its own forcing. Each needs the forcing
 * and the cover it produces; a bare quickened crag or a stilled meadow stays unnamed.
 */
function magicalBiome(map: PhysicalField, i: number) {
  const trees = map.TreeCover[i],
    cover = trees + map.GrassCover[i] + map.WetlandCover[i];
  return (
    quickenedBiome(map, i, trees, cover) ??
    stilledBiome(map, i, trees, cover) ??
    foggedBiome(map, i, trees, cover)
  );
}
/** Fire's quickened country: a grove where the quickening grew trees, a meadow otherwise. */
function quickenedBiome(map: PhysicalField, i: number, trees: number, cover: number) {
  if (map.Quickening[i] < 0.25 || cover < 0.12) return null;
  return B(trees >= 0.3 ? "Ember grove" : "Thaw meadow");
}
/** Aurora's stilled country: old trees standing in rime, or lichen on bare charged rock. */
function stilledBiome(map: PhysicalField, i: number, trees: number, cover: number) {
  if (map.Stillness[i] < 0.45) return null;
  if (trees >= 0.3) return B("Rime forest");
  return cover < 0.12 ? B("Glow-lichen barrens") : null;
}
/** The coast a Pressure front faces: fog-fed heath, or moss forest where trees took hold. */
function foggedBiome(map: PhysicalField, i: number, trees: number, cover: number) {
  if (map.FogForcing[i] < 0.3 || cover < 0.12) return null;
  return B(trees >= 0.4 ? "Moss forest" : "Fog heath");
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
