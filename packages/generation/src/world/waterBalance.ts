/**
 * One water budget for a cell's year, in two seasons. Water arrives as rain and as snow that
 * melts when it is warm; the air takes what its warmth can evaporate; what is left runs off
 * the surface or sinks into the ground, and what sank comes back to the rivers steadily. All
 * depths are in one unit (millimetres) and all rates are per year.
 *
 * Nothing here is a share-of-the-rain loss: a dry, hot cell evaporates nearly all of a small
 * rainfall and a cool, wet one very little of a large one, by the same curve.
 */

/** The mean warmth of the warm and the cold half of a year that swings as a sine. */
export function seasonWarmth(mean: number, halfRange: number) {
  const swing = (2 / Math.PI) * Math.max(0, halfRange);
  return { warm: mean + swing, cold: mean - swing };
}
/**
 * The share of the water supplied to a piece of ground that evaporates, from how the air's
 * demand compares with the supply. With no demand none evaporates; with demand far above the
 * supply nearly all does, and in between both limits are felt (Budyko's curve).
 */
export function evaporatedShare(demand: number, supply: number) {
  if (!(supply > 0)) return 0;
  const aridity = Math.max(0, demand) / supply;
  if (aridity === 0) return 0;
  return Math.min(1, Math.sqrt(aridity * Math.tanh(1 / aridity) * (1 - Math.exp(-aridity))));
}
export interface YearOfWater {
  /** Rain over the year, falling evenly through it. */
  rain: number;
  /** Snow over the year, falling in the cold half. */
  snow: number;
  /** What the air could evaporate in a year at the warm half's warmth, and at the cold half's. */
  warmDemand: number;
  coldDemand: number;
  /** The most snow the warm half can melt. */
  meltCapacity: number;
}
/** What is left of a year's water after the air has had its share, by season. */
export function waterSurplus(year: YearOfWater) {
  const melt = Math.min(Math.max(0, year.snow), Math.max(0, year.meltCapacity)),
    warmSupply = Math.max(0, year.rain) / 2 + melt,
    coldSupply = Math.max(0, year.rain) / 2,
    // Half a year's demand acts on half a year's water.
    warm = warmSupply * (1 - evaporatedShare(year.warmDemand / 2, warmSupply)),
    cold = coldSupply * (1 - evaporatedShare(year.coldDemand / 2, coldSupply));
  return {
    warm,
    cold,
    evaporated: warmSupply + coldSupply - warm - cold,
    /** Snow the warm half could not melt: it stays as ice and is no part of this year's water. */
    keptSnow: Math.max(0, year.snow) - melt,
  };
}
/** Surplus water runs off the surface or sinks in, by the share the ground takes. */
export function partitionSurplus(surplus: number, infiltration: number) {
  const sinking = Math.max(0, surplus) * Math.max(0, Math.min(1, infiltration));
  return { quick: Math.max(0, surplus) - sinking, recharge: sinking };
}
/**
 * What a cell gives its river, as yearly rates. Groundwater returns steadily all year; surface
 * water comes with its season. The river's year-round flow is what the drier season still
 * gives, its flood what the wetter season gives, and its mean lies between.
 */
export function flowYields(quickWarm: number, quickCold: number, baseflow: number) {
  const steady = Math.max(0, baseflow),
    warm = 2 * Math.max(0, quickWarm),
    cold = 2 * Math.max(0, quickCold);
  return {
    perennial: steady + Math.min(warm, cold),
    mean: steady + (warm + cold) / 2,
    flood: steady + Math.max(warm, cold),
  };
}
