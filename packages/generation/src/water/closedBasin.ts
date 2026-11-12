import type { PhysicalField } from "../world/field";
import { airDemand, monthlyWarmth } from "./waterBalance";

/**
 * Whether a basin's floor loses more water than reaches it, so the basin stays closed: a
 * terminal lake, a salt flat or a dry pan. A wetter basin fills to its spill and overflows,
 * and its river continues. This is the one statement of that test, for whoever asks.
 */

/** Rain and snow over the air's yearly demand, below which a basin stays closed. */
export const closedBasinAridity = 0.5;

/** What the air can take from a cell over a year, in millimetres, through its twelve months. */
export function yearlyAirDemand(map: PhysicalField, cell: number) {
  let demand = 0;
  for (const warmth of monthlyWarmth(
    map.Temperature.get(cell) / 10 - 30,
    map.Seasonality.get(cell)
  ))
    demand += airDemand(warmth);
  return demand;
}
/** Whether rain and snow fall short of what the air takes by enough to keep a basin closed. */
export const closedByAridity = (map: PhysicalField, cell: number) =>
  map.Rainfall.get(cell) + map.Snowfall.get(cell) < closedBasinAridity * yearlyAirDemand(map, cell);
