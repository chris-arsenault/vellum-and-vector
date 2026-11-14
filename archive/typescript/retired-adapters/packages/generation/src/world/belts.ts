import type { PhysicalProfile } from "./profile";

const bell = (offset: number, width: number) => Math.exp(-((offset / width) ** 2));

/**
 * Rainout multiplier of the pressure belts. Rising air at the equatorial
 * convergence and along the westerlies' storm track rains out faster;
 * subsiding air under the subtropical and polar highs holds its moisture.
 * Boundaries follow the circulation cells, so other cell counts move the belts.
 */
/**
 * The share of the year's rain and snow that falls in each of twelve months, coldest first.
 * The belts follow the sun: towards a hemisphere's pole in its summer, back towards the
 * equator in its winter, and further over land than over sea. A month's share is the belts'
 * rainout where they stand that month. So the tropics' margins get a wet summer under the
 * convergence and a dry winter under the high, the west coasts beyond them a dry summer and
 * winter storms, and the equator two wet seasons as the belt passes twice.
 *
 * `swing` is 0 over open sea to 1 deep inland, the measure the temperature's yearly range
 * uses. The year's total is not changed here; only when it falls.
 */
export function rainThroughYear(
  p: PhysicalProfile,
  latitude: number,
  swing: number,
  shares: Float64Array
) {
  const reach = p.AxialTilt * Math.min(1, Math.max(0, swing)),
    poleward = latitude < 0 ? -1 : 1;
  let total = 0;
  for (let month = 0; month < shares.length; month++) {
    // Month 0 is the coldest: the sun stands over the other hemisphere.
    const sun = -Math.cos((2 * Math.PI * month) / shares.length);
    shares[month] = beltRainout(p, latitude - poleward * reach * sun);
    total += shares[month];
  }
  for (let month = 0; month < shares.length; month++) shares[month] /= total;
  return shares;
}
export function beltRainout(p: PhysicalProfile, latitude: number) {
  const width = 90 / Math.max(1, p.CirculationCellsPerHemisphere),
    spread = width / 4,
    distance = Math.abs(latitude);
  // The storm track is strongest where the poleward temperature gradient is.
  const gradient = Math.abs(Math.sin((2 * distance * Math.PI) / 180));
  const factor =
    1 +
    p.EquatorialConvergence * bell(distance, p.EquatorialConvergenceWidth) +
    p.StormTrackStrength * gradient * bell(distance - (5 * width) / 3, spread * 1.5) -
    p.SubtropicalSubsidence * bell(distance - width, p.SubtropicalSubsidenceWidth) -
    p.PolarSubsidence * bell(distance - 3 * width, spread);
  return Math.max(p.MinimumRainout, factor);
}
