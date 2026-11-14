import { ask } from "../coupling/answers";
import type { MapProcessContext } from "../process";
import { nativeContext } from "../world/context";
import type { PhysicalField } from "../world/field";
import { MapScale } from "@atlas/domain";
import { onRiver, reachAt, reachesOf, riverSample } from "../water/riverKeeping";
import { soilWaterCapacity } from "../water/soilWater";
import { months } from "../water/waterBalance";
import { waterAccountLine } from "../water/waterLedger";
import { isContent } from "./lattice";
import type { RegionalState } from "./state";

/**
 * What the map's dry land is like for whoever lives on it, as one line: the share of the map
 * that is dry, and over that dry land the means of what its yields are made from and of its
 * water. It is read out each round so a change in what the land feeds, or in its rivers, can
 * be traced to what changed in the land.
 */
const measured = {
  season: 0,
  soil: 0,
  moisture: 0,
  slope: 0,
  trees: 0,
  grass: 0,
  river: 0,
  rain: 0,
  runoff: 0,
  recharge: 0,
  allYear: 0,
  partYear: 0,
  warmth: 0,
  demand: 0,
  within: 0,
  capacity: 0,
  oldBed: 0,
};
/** 1 where the cell lies on a dry reach: a river's course with no river in it now. */
const oldBed = (map: PhysicalField, cell: number) => (reachAt(map, cell)?.dry ? 1 : 0);
/** How many of the map's reaches run, and how many are dry courses. */
function oldCourses(map: PhysicalField) {
  let running = 0,
    dry = 0;
  for (const reach of reachesOf(map))
    if (reach.dry) dry++;
    else running++;
  return `${running} running reaches, ${dry} dry`;
}
export function landReadout(state: RegionalState, context: MapProcessContext) {
  const map = state.physical.map,
    season = ask(map, "season", nativeContext(state, context, 0)),
    sums = { ...measured };
  let land = 0,
    all = 0;
  for (let cell = 0; cell < map.mesh.count; cell++) {
    if (!isContent(map.mesh, cell)) continue;
    const area = map.mesh.area(cell),
      flowing = riverSample(map, cell, "months");
    all += area;
    if (map.WaterKindCodes.get(cell) !== 0) continue;
    land += area;
    sums.season += season.get(cell) * area;
    sums.soil += map.SoilDepth.get(cell) * area;
    sums.moisture += (map.Moisture.get(cell) / 1000) * area;
    sums.slope += map.Slope.get(cell) * area;
    sums.trees += map.TreeCover.get(cell) * area;
    sums.grass += map.GrassCover.get(cell) * area;
    sums.river += (onRiver(map, cell) ? 1 : 0) * area;
    sums.rain += (map.Rainfall.get(cell) + map.Snowfall.get(cell)) * area;
    sums.runoff += map.Runoff.get(cell) * area;
    sums.recharge += map.WaterRecharge.get(cell) * area;
    sums.allYear += (flowing >= months ? 1 : 0) * area;
    sums.partYear += (flowing > 0 && flowing < months ? 1 : 0) * area;
    sums.warmth += (map.Temperature.get(cell) / 10 - 30) * area;
    sums.demand += map.AirDemand.get(cell) * area;
    // The most a cell's air could take of what falls on it, were the year without seasons.
    sums.within +=
      Math.min(map.AirDemand.get(cell), map.Rainfall.get(cell) + map.Snowfall.get(cell)) * area;
    sums.capacity += MapScale.inUnits(soilWaterCapacity(map, cell), "mm") * area;
    sums.oldBed += oldBed(map, cell) * area;
  }
  const mean = (value: number, digits = 3) => (land > 0 ? value / land : 0).toFixed(digits);
  return (
    `dry land ${(all > 0 ? (100 * land) / all : 0).toFixed(1)}% of the map; over it: ` +
    `growing season ${mean(sums.season)}, soil ${mean(sums.soil)} m, moisture ${mean(sums.moisture)}, ` +
    `slope ${mean(sums.slope)}, tree cover ${mean(sums.trees)}, grass ${mean(sums.grass)}, ` +
    `on a river ${mean(sums.river)}, on an old bed ${mean(sums.oldBed)} (${oldCourses(map)}); ` +
    `mean warmth ${mean(sums.warmth, 1)} degrees, the air could take ${mean(sums.demand, 0)} mm ` +
    `(${mean(sums.within, 0)} mm of it where the rain falls), soil holds ${mean(sums.capacity, 0)} mm; ` +
    `water: ${mean(sums.rain, 0)} mm falls, ` +
    `${mean(sums.runoff, 0)} mm runs off, ${mean(sums.recharge, 0)} mm sinks in; ` +
    `a river's flow all year on ${mean(sums.allYear)} of it, part of the year on ${mean(sums.partYear)}; ` +
    waterAccountLine(map)
  );
}
