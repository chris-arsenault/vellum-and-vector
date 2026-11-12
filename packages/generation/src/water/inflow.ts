import type { Band } from "@atlas/domain";
import { months } from "./waterBalance";

/**
 * A river that enters the map across its edge. The map it comes from says what it brings on
 * average and what it still brings in its driest month. Between those it rises and falls
 * with the seasons of the ground it enters, which are the seasons of the country just
 * upstream: it is highest in the month that ground sheds most and lowest in the month it
 * sheds least. Its mean over the year is what the other map said.
 */
export function enteringFlow(
  mean: number,
  least: number,
  /** What the entered ground sheds this month, in its driest month and on average. */
  shed: number,
  driest: number,
  average: number
) {
  const steady = Math.max(0, Math.min(mean, least)),
    swing = average - driest;
  return swing > 0 ? steady + ((mean - steady) * (shed - driest)) / swing : mean;
}
/** What enters at a cell in one month, from the cell's own year of water. */
export function enteringInMonth(
  each: readonly Band[],
  i: number,
  month: number,
  mean: number,
  steady?: Band
) {
  if (!(mean > 0)) return 0;
  const least = steady ? steady.get(i) : mean;
  if (least >= mean) return mean;
  let driest = Infinity,
    total = 0;
  for (const band of each) {
    driest = Math.min(driest, band.get(i));
    total += band.get(i);
  }
  return enteringFlow(mean, least, each[month].get(i), driest, total / months);
}
