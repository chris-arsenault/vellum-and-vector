import { MapScale, waterYearFields, type Band } from "@atlas/domain";
import { moveWater } from "./waterLedger";
import { holdSoilWater, soilWaterCapacity } from "./soilWater";
import { ask } from "../coupling/answers";
import { groundOf } from "../rock/ground";
import { surfacePorosity } from "../rock/groundQueries";
import type { PhysicalContext } from "../world/context";
import type { PhysicalField } from "../world/field";
import { airDemand, monthlyWarmth, months, waterYear, type WaterYear } from "./waterBalance";

/**
 * Every land cell's water for the year, from one budget (see `waterBalance`). The year's rain
 * and snow are set month by month against what the air can take; the soil carries water from
 * wet months into dry ones and a winter's snow is the thaw's water. What the soil sheds runs
 * off the surface or sinks in, by what the ground takes. A cell then states, in millimetres a
 * year, what its surface gives on average, in its wettest month and in its driest, and what
 * sank for the groundwater; and it keeps the twelve months for the rivers to gather.
 */
const degrees = (native: number) => native / 10 - 30;
const millimetres = (metres: number) => MapScale.inUnits(metres, "mm");

/** A cell's year of water: the band of each month, coldest first, held on the map itself. */
export const waterYearOf = (map: PhysicalField) => waterYearFields.map((name) => map[name]);
/** The share of water shed by full soil that the ground takes in before it can run off. */
function sinkingShare(map: PhysicalField, i: number) {
  // Soil and what grows in it say how much goes in; before anything grows, the rock does.
  const taken = map.EcologyInitialized
      ? map.Infiltration.get(i)
      : groundOf(map).fold(i, surfacePorosity),
    // Wetlands and peat hold water back and let it go slowly, as the ground does.
    held = map.EcologyInitialized
      ? Math.min(1, 0.3 * map.WetlandCover.get(i) + map.PeatCarbon.get(i) / 60)
      : 0;
  return 1 - (1 - Math.max(0, Math.min(1, taken))) * (1 - held);
}
/** The share of bare ground: rain on plant cover soaks in where rain on bare ground runs. */
const bare = (map: PhysicalField, i: number) =>
  1 - Math.min(1, map.TreeCover.get(i) + map.GrassCover.get(i) + map.WetlandCover.get(i));

const year = {
  rain: new Float64Array(months),
  snow: new Float64Array(months),
  demand: new Float64Array(months),
  melt: new Float64Array(months),
};
/** A cell's twelve months of rain, snow, demand and melt, from its yearly climate. */
function climateYear(map: PhysicalField, c: PhysicalContext, i: number) {
  // A river carrying magical warmth warms the air over it, which then takes more.
  const warmth = monthlyWarmth(
      degrees(map.Temperature.get(i) + map.RiverWarmth.get(i)),
      map.Seasonality.get(i)
    ),
    falling = (map.Rainfall.get(i) + map.Snowfall.get(i)) / months;
  for (let at = 0; at < months; at++) {
    const thawed = warmth[at] > 0;
    year.rain[at] = thawed ? falling : 0;
    year.snow[at] = thawed ? 0 : falling;
    year.demand[at] = airDemand(warmth[at]);
    year.melt[at] = c.Profile.SnowMeltPerDegree * Math.max(0, warmth[at]);
  }
  return year;
}
/** A year's moves over the land, in cubic metres, summed before they enter the ledger. */
const landMoves = [
  "rain",
  "snowfall",
  "thaw",
  "firn",
  "evaporation",
  "runoff",
  "recharge",
] as const;
type LandMoves = Record<(typeof landMoves)[number], number>;
/** One cell's year, added to the land's moves: depths in millimetres over the cell's area. */
function noteYear(moved: LandMoves, fell: typeof year, water: WaterYear, area: number) {
  const depth = area / 1000;
  let rain = 0,
    snow = 0,
    quick = 0;
  for (let at = 0; at < months; at++) {
    rain += fell.rain[at];
    snow += fell.snow[at];
    quick += water.quick[at];
  }
  moved.rain += rain * depth;
  moved.snowfall += snow * depth;
  moved.thaw += (snow - water.keptSnow) * depth;
  moved.firn += water.keptSnow * depth;
  moved.evaporation += water.evaporated * depth;
  moved.runoff += quick * depth;
  moved.recharge += water.recharge * depth;
}
export function runoff(map: PhysicalField, c: PhysicalContext) {
  const each = waterYearOf(map),
    moved = Object.fromEntries(landMoves.map((move) => [move, 0])) as LandMoves;
  landWater(map, c, each, moved);
  for (const move of landMoves) moveWater(map, move, moved[move]);
}
function landWater(map: PhysicalField, c: PhysicalContext, each: Band[], moved: LandMoves) {
  // What else wets a soil, and what keeps one wet, is said by whoever does it.
  const wetting = ask(map, "soilWetting", c),
    held = ask(map, "soilWaterHeld", c),
    yields = [map.Runoff, map.FloodRunoff, map.DryRunoff, map.WaterRecharge, map.SoilWater];
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes.get(i) === 1) {
      for (const band of [...yields, ...each]) band.set(i, 0);
      continue;
    }
    const sinking = sinkingShare(map, i),
      fell = climateYear(map, c, i),
      water = waterYear({
        ...fell,
        soilCapacity: millimetres(soilWaterCapacity(map, i)),
        sinking,
        stormShare: c.Profile.StormRunoffShare * (1 - sinking) * bare(map, i),
      });
    let total = 0,
      least = Infinity,
      greatest = 0;
    for (let at = 0; at < months; at++) {
      const quick = water.quick[at];
      each[at].set(i, quick);
      total += quick;
      least = Math.min(least, quick);
      greatest = Math.max(greatest, quick);
    }
    map.Runoff.set(i, total);
    map.FloodRunoff.set(i, greatest * months);
    map.DryRunoff.set(i, least * months);
    map.WaterRecharge.set(i, water.recharge);
    holdSoilWater(map, i, water.soil, wetting.get(i), held.get(i));
    noteYear(moved, fell, water, map.mesh.area(i));
  }
}
