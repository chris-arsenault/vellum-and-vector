import { MapScale } from "@atlas/domain";
import { groundOf } from "../rock/ground";
import { surfacePorosity } from "../rock/groundQueries";
import type { PhysicalContext } from "./context";
import { potentialEvaporation } from "./ecologyEnvironment";
import type { PhysicalField } from "./field";
import { monthlyWarmth, months, waterYear } from "./waterBalance";

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

/** By map: what each cell's surface gives in each month, in millimetres, twelve to a cell. */
const monthly = new WeakMap<PhysicalField, Float32Array>();
export function monthlyRunoff(map: PhysicalField) {
  let held = monthly.get(map);
  if (!held || held.length !== map.mesh.count * months) {
    held = new Float32Array(map.mesh.count * months);
    monthly.set(map, held);
  }
  return held;
}
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
/** The water the soil holds when full, as the soil model holds it. */
const soilCapacity = (map: PhysicalField, i: number) =>
  millimetres(map.SoilDepth.get(i) * (0.12 + Math.min(1, map.SoilCarbon.get(i) / 30) * 0.15));
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
    year.demand[at] = thawed
      ? millimetres(potentialEvaporation(warmth[at], map.scale)) / months
      : 0;
    year.melt[at] = c.Profile.SnowMeltPerDegree * Math.max(0, warmth[at]);
  }
  return year;
}
export function runoff(map: PhysicalField, c: PhysicalContext) {
  const each = monthlyRunoff(map);
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes.get(i) === 1) {
      for (const band of [map.Runoff, map.FloodRunoff, map.DryRunoff, map.WaterRecharge])
        band.set(i, 0);
      each.fill(0, i * months, (i + 1) * months);
      continue;
    }
    const sinking = sinkingShare(map, i),
      water = waterYear({
        ...climateYear(map, c, i),
        soilCapacity: soilCapacity(map, i),
        sinking,
        stormShare: c.Profile.StormRunoffShare * (1 - sinking) * bare(map, i),
      });
    let total = 0,
      least = Infinity,
      greatest = 0;
    for (let at = 0; at < months; at++) {
      const quick = water.quick[at];
      each[i * months + at] = quick;
      total += quick;
      least = Math.min(least, quick);
      greatest = Math.max(greatest, quick);
    }
    map.Runoff.set(i, total);
    map.FloodRunoff.set(i, greatest * months);
    map.DryRunoff.set(i, least * months);
    map.WaterRecharge.set(i, water.recharge);
  }
}
