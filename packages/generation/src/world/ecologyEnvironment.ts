import { MapScale, biomeCode as B } from "@atlas/domain";
import type { PhysicalField } from "./field";
import { onRiver } from "../water/riverKeeping";

export const unit = (value: number) => Math.max(0, Math.min(1, value));
/** Floodplain and delta classifications can overlap on the same wet ground. */
export const floodWetness = (floodplain: number, delta: number) =>
  unit(Math.max(floodplain, delta) / 1000);
/** The share of wetland cover at which ground is a wetland. */
export const wetlandCoverShare = 0.3;
/** Above this gradient water runs off rather than stands. */
export const standingWaterSlope = 0.015;
/** The one definition of a wetland: land held wet by what grows on it, not a water surface. */
export const isWetland = (map: PhysicalField, i: number) =>
  map.WaterKindCodes.get(i) === 0 && map.WetlandCover.get(i) >= wetlandCoverShare;
/** Wind speed relative to the map's prevailing-flow scale; absent flow uses unit strength. */
export const windStrength = (map: PhysicalField, i: number) => {
  const speed = map.WindSpeed.get(i);
  return speed > 0 ? speed / map.scale.length(0.00000175) : 1;
};
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
  /** Greenwood: life in sap and groundwater that grows past the climate, 0 to 1. */
  verdure: number;
  /** Salt: the residue that thins cover, starves soil and turns grazers away, 0 to 1. */
  salting: number;
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
  verdure: 0,
  salting: 0,
};
/**
 * Plant water: the year's rain and snow over what the air could evaporate, at most 1. The
 * air's demand is the climate's own figure, the one the water budget and the lakes use.
 * Where the air asks nothing (frozen all year) whatever falls is all surplus.
 */
export function plantWater(map: PhysicalField, i: number) {
  const fell = map.Rainfall.get(i) + map.Snowfall.get(i),
    demand = map.AirDemand.get(i);
  return demand > 0 ? Math.min(1, fell / demand) : fell > 0 ? 1 : 0;
}
export function environment(map: PhysicalField, i: number, forcing = neutralEcology) {
  // A river carrying magical warmth is warmer than its banks and does not freeze.
  const warmth = onRiver(map, i) ? map.RiverWarmth.get(i) : 0;
  const temperature = (map.Temperature.get(i) + warmth) / 10 - 30;
  const depth = MapScale.metres(map.WaterDepths.get(i), "native");
  const water = map.WaterKindCodes.get(i),
    ice = map.IceThickness.get(i);
  // Warm river water keeps a reach open through a skin of ice, not under a glacier.
  const frozen =
    ice > map.scale.resolveMeasure(frozenIce) &&
    !(warmth >= 50 && ice <= map.scale.length(0.0000125));
  const warmSeason = unit((temperature + 8) / 18) * unit((52 - temperature) / 18);
  // Plant water is the aridity index: precipitation over evaporative demand. Column
  // humidity is not surface humidity: heavy rainout drains the column exactly where
  // plants have most water.
  const moisture = plantWater(map, i);
  // Climate supplies each cell's seasonal half-range; the epoch's seasonality
  // scales it, with the neutral 0.3 leaving it unchanged. Before climate has
  // run, the former uniform 7.5 °C half-range at neutral seasonality applies.
  const seasonality = map.Seasonality.get(i);
  const range =
    seasonality > 0
      ? (seasonality * forcing.seasonality) / neutralEcology.seasonality
      : forcing.seasonality * 25;
  const summer = temperature + range;
  const winter = temperature - range;
  const drought = unit(
    1 -
      moisture * (1 - forcing.seasonality * 0.55) -
      map.SoilWater.get(i) / map.scale.length(2.5e-7)
  );
  const flat = unit(1 - map.Slope.get(i) / standingWaterSlope);
  const drainage = unit(
    MapScale.metres(map.DrainageElevations.get(i) - map.Elevation.get(i), "native") /
      map.scale.length(7.5e-7)
  );
  const flood = floodWetness(map.FloodplainIntensity.get(i), map.DeltaIntensity.get(i));
  const wetness = water
    ? unit(1 - depth / map.scale.length(7.5e-7))
    : flat * unit(drainage + flood + (moisture - 0.7) * 1.8);
  const submerged = water !== 0 && (water === 1 || depth > map.scale.length(3.75e-7));
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
  if (isWetland(map, i)) return B(map.TreeCover.get(i) > 0.2 ? "Swamp" : "Marsh");
  if (env.temperature < 2) return B("Tundra");
  return coverBiome(map, i, env);
}
/**
 * Living landscapes a magic system makes through its own forcing. Each needs the forcing
 * and the cover it produces; a bare quickened crag or a stilled meadow stays unnamed. The
 * canopy is the mature broadleaf and conifer cover, the same measure the region rules use.
 */
function magicalBiome(map: PhysicalField, i: number) {
  const trees = map.BroadleafCover.get(i) + map.ConiferCover.get(i),
    cover = map.TreeCover.get(i) + map.GrassCover.get(i) + map.WetlandCover.get(i);
  return (
    quickenedBiome(map, i, trees, cover) ??
    stilledBiome(map, i, trees, cover) ??
    foggedBiome(map, i, trees, cover) ??
    verdantBiome(map, i, trees, cover)
  );
}
/** Greenwood's country: the Deepwood, the fen a river braids through it, the meadow at a spring. */
function verdantBiome(map: PhysicalField, i: number, trees: number, cover: number) {
  if (map.Verdure.get(i) < 0.3 || cover < 0.12) return null;
  if (trees >= 0.5) return B("Deepwood");
  return map.WetlandCover.get(i) >= 0.3 ? B("Wending fen") : B("Well meadow");
}
/** Fire's quickened country: a grove where the quickening grew trees, a meadow otherwise. */
function quickenedBiome(map: PhysicalField, i: number, trees: number, cover: number) {
  if (map.Quickening.get(i) < quickenedFrom || cover < 0.12) return null;
  return B(trees >= 0.3 ? "Ember grove" : "Thaw meadow");
}
/** Aurora's stilled country: old trees standing in rime, or lichen on bare charged rock. */
function stilledBiome(map: PhysicalField, i: number, trees: number, cover: number) {
  if (map.Stillness.get(i) < stilledFrom) return null;
  if (trees >= 0.3) return B("Rime forest");
  return cover < 0.12 ? B("Glow-lichen barrens") : null;
}
/** The coast a Pressure front faces: fog-fed heath, or moss forest where trees took hold. */
function foggedBiome(map: PhysicalField, i: number, trees: number, cover: number) {
  if (map.FogForcing.get(i) < foggedFrom || cover < 0.12) return null;
  return B(trees >= 0.4 ? "Moss forest" : "Fog heath");
}
/** The forcing at which ground is quickened, stilled or fogged country. */
export const quickenedFrom = 0.25,
  stilledFrom = 0.45,
  foggedFrom = 0.3;
/** Relative ice depth that freezes ground. */
export const frozenIce = MapScale.length(2.5e-7);
/** Below this share of living cover the ground is bare; below this plant water, bare ground is desert. */
export const bareCover = 0.12,
  desertMoisture = 0.25;
/** The tree share at which open country is woodland. */
export const woodlandTrees = 0.15;
function coverBiome(map: PhysicalField, i: number, env: EcologyEnvironment) {
  const trees = map.TreeCover.get(i),
    cover = trees + map.GrassCover.get(i) + map.WetlandCover.get(i);
  if (cover < bareCover) return B(env.moisture < desertMoisture ? "Desert" : "Barren");
  if (trees < woodlandTrees) return B("Grassland");
  if (trees < 0.4) return B(env.temperature > 18 ? "Savanna" : "Woodland");
  if (map.ConiferCover.get(i) > map.BroadleafCover.get(i) || env.temperature < 8)
    return B("Boreal forest");
  return B(env.temperature > 22 && env.moisture > 0.7 ? "Rainforest" : "Temperate forest");
}
