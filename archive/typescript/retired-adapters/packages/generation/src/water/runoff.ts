import { MapScale, waterYearFields, type Band } from "@atlas/domain";
import { moveWater } from "./waterLedger";
import { holdSoilWater, soilWaterCapacity } from "./soilWater";
import { putSnow, putSoilWater } from "./column";
import { ask } from "../coupling/answers";
import { groundOf } from "../rock/ground";
import { surfacePorosity } from "../rock/groundQueries";
import type { PhysicalContext } from "../world/context";
import type { PhysicalField } from "../world/field";
import { rainThroughYear } from "../world/belts";
import { seasonalSwing } from "../world/climate";
import { latitudeAt } from "../world/latitude";
import { airDemandThroughYear } from "./closedBasin";
import { months, waterYear, type WaterYear } from "./waterBalance";

/**
 * Every land cell's water for the year, from one budget (see `waterBalance`). The year's rain
 * and snow are set month by month against what the air can take; the soil carries water from
 * wet months into dry ones and a winter's snow is the thaw's water. What the soil sheds runs
 * off the surface or sinks in, by what the ground takes. A cell then states, in millimetres a
 * year, what its surface gives on average, in its wettest month and in its driest, and what
 * sank for the groundwater; and it keeps the twelve months for the rivers to gather.
 */
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
  share: new Float64Array(months),
};
/** A cell's twelve months of rain, snow, demand and melt, from its yearly climate. */
function climateYear(map: PhysicalField, c: PhysicalContext, i: number) {
  // A river carrying magical warmth warms the air over it, which then takes more.
  const warmth = airDemandThroughYear(map, c.Profile, i, year.demand, map.RiverWarmth.get(i)),
    latitude = latitudeAt(c.Profile, map, i),
    // The year's fall comes in the months the rain belts stand over the cell.
    share = rainThroughYear(
      c.Profile,
      latitude,
      seasonalSwing(c.Profile, latitude, map.Seasonality.get(i)),
      year.share
    ),
    fell = map.Rainfall.get(i) + map.Snowfall.get(i);
  for (let at = 0; at < months; at++) {
    const thawed = warmth[at] > 0,
      falling = fell * share[at];
    year.rain[at] = thawed ? falling : 0;
    year.snow[at] = thawed ? 0 : falling;
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
    thaw = 0,
    quick = 0;
  for (let at = 0; at < months; at++) {
    rain += fell.rain[at];
    snow += fell.snow[at];
    thaw += water.thaw[at];
    quick += water.quick[at];
  }
  moved.rain += rain * depth;
  moved.snowfall += snow * depth;
  moved.thaw += thaw * depth;
  moved.firn += water.keptSnow * depth;
  moved.evaporation += water.evaporated * depth;
  moved.runoff += quick * depth;
  moved.recharge += water.recharge * depth;
}
/** An explicit water occurrence commits its returned year's supply and ending contents together. */
export function advanceWaterYear(map: PhysicalField, c: PhysicalContext) {
  const each = waterYearOf(map),
    moved = Object.fromEntries(landMoves.map((move) => [move, 0])) as LandMoves;
  landWater(map, c, each, moved);
  for (const move of landMoves) moveWater(map, move, moved[move]);
}
/** Current runoff is a view of the established year; reading it spends no held water. */
export function runoff(map: PhysicalField) {
  const each = waterYearOf(map);
  for (let cell = 0; cell < map.mesh.count; cell++) {
    let total = 0,
      least = Infinity,
      greatest = 0;
    for (const band of each) {
      const quick = band.get(cell);
      total += quick;
      least = Math.min(least, quick);
      greatest = Math.max(greatest, quick);
    }
    map.Runoff.set(cell, total);
    map.FloodRunoff.set(cell, greatest * months);
    map.DryRunoff.set(cell, least * months);
  }
}
function landWater(map: PhysicalField, c: PhysicalContext, each: Band[], moved: LandMoves) {
  // What else wets a soil, and what keeps one wet, is said by whoever does it.
  const wetting = ask(map, "soilWetting", c),
    held = ask(map, "soilWaterHeld", c),
    yields = [map.WaterRecharge, map.SnowKept];
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes.get(i) === 1) {
      for (const band of [...yields, ...each]) band.set(i, 0);
      // The sea floor holds no soil water or snow of its own.
      putSoilWater(map, i, 0);
      putSnow(map, i, 0);
      continue;
    }
    const sinking = sinkingShare(map, i),
      fell = climateYear(map, c, i),
      capacity = millimetres(soilWaterCapacity(map, i)),
      water = waterYear(
        {
          ...fell,
          soilCapacity: capacity,
          sinking,
          stormShare: c.Profile.StormRunoffShare * (1 - sinking) * bare(map, i),
        },
        // What the cell's column holds from before: carried with its ground, or inherited.
        {
          soil: millimetres(map.SoilWater.get(i)),
          snow: millimetres(map.SnowPack.get(i)),
        }
      );
    for (let at = 0; at < months; at++) each[at].set(i, water.quick[at]);
    map.WaterRecharge.set(i, water.recharge);
    map.SnowKept.set(i, water.keptSnow);
    // The snow that lies through the year is part of what the cell holds.
    putSnow(map, i, MapScale.metres(water.end.snow, "mm"));
    holdSoilWater(map, i, water.end.soil, wetting.get(i), held.get(i));
    noteYear(moved, fell, water, map.mesh.area(i));
  }
}
