import type { Band } from "@atlas/domain";
import type { PhysicalContext } from "../world/context";
import type { PhysicalField } from "../world/field";
import { targetOrder } from "../world/flowGraph";
import { clamp } from "../world/math";
import { releaseWorking, workingArray } from "../world/physicalNumerics";
import { moveWater } from "./waterLedger";

/**
 * Water that ice gives up in a typical year. Ice makes no water: it gives back the snow it
 * was fed. Snow that outlasts the year rides down the ice and melts out along the way by how
 * warm it is, and all of it is out where the ice ends. Ice that reaches the sea calves, and
 * kept snow with no ice to carry it goes back to the air. Where something outside the climate
 * keeps ice melted (a volcano, a magic, a place), all the snow and ice that reach that ground
 * melt there: the heat makes no water of its own, it decides where the ice's water comes out.
 *
 * Ice that grows or shrinks between passes does so over the ages a pass stands for. Spread
 * over those ages it is far less than a millimetre a year, so it is no part of the year's
 * water: counting a pass's thinning as a year's melt drowned warm country in rivers.
 */

/** The share of what the ice carries past a cell that melts out there, by its warmth. */
function thawShare(map: PhysicalField, c: PhysicalContext, i: number) {
  const p = c.Profile;
  return clamp(
    (map.Temperature.get(i) - p.GlacialMeltTemperatureFloor) /
      Math.max(1, p.IceTemperatureThreshold - p.GlacialMeltTemperatureFloor),
    0,
    1
  );
}
const iced = (map: PhysicalField, i: number) =>
  map.WaterKindCodes.get(i) === 0 && map.IceThickness.get(i) > 0;

interface IceWater {
  fed: number;
  outside: number;
  calved: number;
  sublimed: number;
}
/** One cell's kept snow, with what the ice brought it: melted here, passed on, calved or sublimed. */
function release(
  map: PhysicalField,
  c: PhysicalContext,
  i: number,
  carried: Band,
  totals: IceWater
) {
  const area = map.mesh.area(i),
    held = carried.get(i) + (map.SnowKept.get(i) / 1000) * area;
  if (map.WaterKindCodes.get(i) !== 0) {
    totals.calved += held;
    return 0;
  }
  if (map.ExternalMeltwater.get(i) > 0) {
    totals.outside += held;
    return held;
  }
  if (!iced(map, i)) {
    // No ice stands here to carry the snow down: it leaves to the air.
    totals.sublimed += (map.SnowKept.get(i) / 1000) * area;
    return carried.get(i);
  }
  const target = map.IceFlowTargets.get(i),
    onward = target >= 0 && (iced(map, target) || map.WaterKindCodes.get(target) !== 0),
    out = onward ? held * thawShare(map, c, i) : held;
  if (onward) carried.add(target, held - out);
  return out;
}
export function glacialMeltwater(map: PhysicalField, c: PhysicalContext) {
  const order = targetOrder(map, map.IceFlowTargets),
    carried = workingArray(map, "float64", "meltwater:carried"),
    totals: IceWater = { fed: 0, outside: 0, calved: 0, sublimed: 0 };
  for (let n = 0; n < order.length; n++) {
    const i = order.get(n),
      area = map.mesh.area(i),
      out = release(map, c, i, carried, totals);
    if (map.WaterKindCodes.get(i) !== 0) {
      map.GlacialMeltwater.set(i, 0);
      continue;
    }
    map.GlacialMeltwater.set(i, (out / area) * 1000);
    totals.fed += out;
  }
  // What the rivers take of the melt is stated where they gather it; these say where it came from.
  moveWater(map, "meltOfKeptSnow", totals.fed - totals.outside);
  moveWater(map, "meltFromOutside", totals.outside);
  moveWater(map, "calving", totals.calved);
  moveWater(map, "sublimation", totals.sublimed);
  releaseWorking(map, order, carried);
}
/**
 * Notes that something outside the climate melted ice here, and how deep (millimetres of
 * water). The depth is a record of the work done over the pass, never a year's water: the
 * melt that reaches rivers is the snow and ice that arrive at this ground each year.
 */
export function receiveMeltwater(map: PhysicalField, i: number, water: number) {
  if (water > 0) map.ExternalMeltwater.add(i, water);
}
/** A new epoch starts with no ice melted from outside and no water yet returned from the ground. */
export function beginWaterEpoch(map: PhysicalField) {
  map.ExternalMeltwater.fill(0);
  map.GroundwaterReturn.fill(0);
}
