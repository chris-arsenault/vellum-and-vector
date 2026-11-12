import type { PhysicalField } from "../world/field";
import { latitudeAt } from "../world/latitude";
import type { PhysicalProfile } from "../world/profile";
import { airDemand, dayLength, monthlyWarmth, months, sunStanding } from "./waterBalance";

/**
 * Whether a basin's floor loses more water than reaches it, so the basin stays closed: a
 * terminal lake, a salt flat or a dry pan. A wetter basin fills to its spill and overflows,
 * and its river continues. This is the one statement of that test, for whoever asks.
 */

/** Rain and snow over the air's yearly demand, below which a basin stays closed. */
export const closedBasinAridity = 0.5;

/**
 * What the air can take from a cell in each month, in millimetres, coldest month first: by
 * the month's warmth and the length of its days. `warmer` is warmth beyond the climate's own.
 */
export function airDemandThroughYear(
  map: PhysicalField,
  p: PhysicalProfile,
  cell: number,
  demand: Float64Array,
  warmer = 0
) {
  const latitude = latitudeAt(p, map, cell),
    warmth = monthlyWarmth(
      (map.Temperature.get(cell) + warmer) / 10 - 30,
      map.Seasonality.get(cell)
    );
  for (let month = 0; month < months; month++)
    demand[month] = airDemand(warmth[month], dayLength(latitude, p.AxialTilt * sunStanding(month)));
  return warmth;
}
const scratch = new Float64Array(months);
/** What the air can take from a cell over a year, in millimetres, through its twelve months. */
export function yearlyAirDemand(map: PhysicalField, p: PhysicalProfile, cell: number) {
  airDemandThroughYear(map, p, cell, scratch);
  let demand = 0;
  for (let month = 0; month < months; month++) demand += scratch[month];
  return demand;
}
/** Whether rain and snow fall short of what the air takes by enough to keep a basin closed. */
export const closedByAridity = (map: PhysicalField, p: PhysicalProfile, cell: number) =>
  map.Rainfall.get(cell) + map.Snowfall.get(cell) <
  closedBasinAridity * yearlyAirDemand(map, p, cell);
