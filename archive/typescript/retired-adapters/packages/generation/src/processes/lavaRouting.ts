/** A neighbor can receive only through an overtopped edge, with resistance to spreading. */
export function lavaOffer(
  head: number,
  beside: number,
  distance: number,
  area: number,
  neighboringArea: number,
  yieldGradient: number
) {
  const excess = head - beside - Math.max(0, yieldGradient) * distance;
  return Math.max(0, excess) / (1 / area + 1 / neighboringArea);
}

/** Cooling arrests part of a pulse at each crossing and ends transport at its remaining runout. */
export function mobileLavaShare(distance: number, remainingDistance: number) {
  return remainingDistance > 0 ? Math.max(0, 1 - distance / remainingDistance) : 0;
}
/** Bingham threshold tau/(rho*g*h): a thicker mobile layer overcomes the same resisting stress.
 * Motivation: USGS Open-File Report 82-314, Flow Capacity of Barriers. */
export const lavaYieldGradient = (yieldHeight: number, mobileDepth: number) =>
  mobileDepth > 0 ? Math.max(0, yieldHeight) / mobileDepth : Infinity;
