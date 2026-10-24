import { population } from "@atlas/domain";
import type { GenerationState } from "./process";
import { declineRate, intrinsicGrowth } from "./societyPopulation";
import { peopleTrait } from "./societyTraits";

/** The shortest and longest years one cycle may span. */
export interface CycleBounds {
  min: number;
  max: number;
}
/** A settled society resolves feedback by the decade and never skips more than a long lifetime. */
export const settledCycle: CycleBounds = { min: 10, max: 80 };
/** A mobile round camps by the generation; its country changes under it, not its towns. */
export const roundCycle: CycleBounds = { min: 25, max: 100 };
/** The share of the world's people one cycle may add or lose before feedback is read again. */
const changePerCycle = 0.25;

/**
 * Years the next cycle should span: those in which the world's people would change by about
 * a fifth at the current rates, the same logistic growth and decline `growPopulation` applies,
 * weighted by where the people are. Early, when every valley has room, cycles are short;
 * once the land is full they stretch to the bound, so a long history costs few cycles while
 * a fast one still resolves. The remaining years split evenly so no cycle is a sliver.
 */
export function societyStep(state: GenerationState, remaining: number, bounds: CycleBounds) {
  let people = 0,
    change = 0;
  for (const c of state.society!.region.communities) {
    if (c.protected) continue;
    const n = population(c);
    if (n <= 0) continue;
    const capacity = c.support.capacity / Math.max(0.01, peopleTrait(state, c, "foodDemand", 1));
    change +=
      capacity > 0
        ? n * intrinsicGrowth * peopleTrait(state, c, "growth", 1) * (1 - n / capacity)
        : -n * declineRate;
    people += n;
  }
  const rate = people > 0 ? Math.abs(change) / people : 0;
  const wanted = rate > 0 ? changePerCycle / rate : bounds.max;
  const years = Math.max(bounds.min, Math.min(bounds.max, wanted));
  if (remaining <= years) return remaining;
  return remaining / Math.ceil(remaining / years);
}
