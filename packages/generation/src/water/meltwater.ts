import { MapScale } from "@atlas/domain";
import type { PhysicalContext } from "../world/context";
import type { PhysicalField } from "../world/field";
import { clamp, truncate } from "../world/math";

/**
 * Water that ice gives up. Ice melts by the warmth above it, the heat under it and how far it
 * retreated; and whatever else melts ice (a volcano, a magic) hands its water over here.
 */
export function glacialMeltwater(map: PhysicalField, c: PhysicalContext) {
  const p = c.Profile;
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes.get(i) !== 0) {
      map.GlacialMeltwater.set(i, 0);
      continue;
    }
    const ice = map.IceThickness.get(i);
    const thaw = clamp(
      truncate(
        ((map.Temperature.get(i) - p.GlacialMeltTemperatureFloor) * 1000) /
          Math.max(1, p.IceTemperatureThreshold - p.GlacialMeltTemperatureFloor)
      ),
      0,
      1000
    );
    const surface = (ice * thaw * p.GlacialAblationRunoffStrength) / 1_000_000;
    const basal = (ice * map.Geothermal.get(i) * p.BasalMeltRunoffStrength) / 1_000_000;
    const retreat = (map.IceRetreat.get(i) * p.GlacialRetreatRunoffStrength) / 1000;
    map.GlacialMeltwater.set(
      i,
      MapScale.inUnits(surface + basal + retreat, "mm") + map.ExternalMeltwater.get(i)
    );
  }
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
