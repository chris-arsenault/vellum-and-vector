import { MapScale, type Band } from "@atlas/domain";
import type { PhysicalContext } from "../world/context";
import type { PhysicalField } from "../world/field";
import { targetOrder } from "../world/flowGraph";
import { clamp } from "../world/math";
import { releaseWorking, workingArray } from "../world/physicalNumerics";
import { moveWater } from "./waterLedger";

/**
 * Water that ice gives up. Ice makes no water: it gives back the snow it was fed and the ice
 * it lost. Snow that outlasts the year rides down the ice and melts out along the way by how
 * warm it is, and all of it is out where the ice ends. Ice that thinned gives its own water
 * where it thinned. Ice that reaches the sea calves, and kept snow with no ice to carry it
 * goes back to the air. Whatever else melts ice (a volcano, a magic) hands its water over here.
 */

/** A depth of ice as the depth of water it melts to. */
const waterOfIce = 0.9;

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
    totals: IceWater = { calved: 0, sublimed: 0 };
  for (let n = 0; n < order.length; n++) {
    const i = order.get(n),
      area = map.mesh.area(i),
      out = release(map, c, i, carried, totals);
    if (map.WaterKindCodes.get(i) !== 0) {
      map.GlacialMeltwater.set(i, 0);
      continue;
    }
    // Ice that thinned over the last span gives the water it was.
    const thinned = Math.max(0, map.IceRetreat.get(i)) * waterOfIce,
      depth = (out / area) * 1000 + MapScale.inUnits(thinned, "mm");
    map.GlacialMeltwater.set(i, depth + map.ExternalMeltwater.get(i));
  }
  // What the rivers take of the melt is stated where they gather it.
  moveWater(map, "calving", totals.calved);
  moveWater(map, "sublimation", totals.sublimed);
  releaseWorking(map, order, carried);
}
/** Ice melted from outside the climate hands over its water, in millimetres a year. */
export function receiveMeltwater(map: PhysicalField, i: number, water: number) {
  map.ExternalMeltwater.add(i, water);
  map.GlacialMeltwater.add(i, water);
}
/** A new epoch starts with no water handed over from outside and none yet returned from the ground. */
export function beginWaterEpoch(map: PhysicalField) {
  map.ExternalMeltwater.fill(0);
  map.GroundwaterReturn.fill(0);
}
