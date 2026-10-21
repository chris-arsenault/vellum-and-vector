import type { PhysicalProfile } from "./profile";

const bell = (offset: number, width: number) => Math.exp(-((offset / width) ** 2));

/**
 * Rainout multiplier of the pressure belts. Rising air at the equatorial
 * convergence and along the westerlies' storm track rains out faster;
 * subsiding air under the subtropical and polar highs holds its moisture.
 * Boundaries follow the circulation cells, so other cell counts move the belts.
 */
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
