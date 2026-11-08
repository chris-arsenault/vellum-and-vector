import { MapScale } from "@atlas/domain";

/** Numerical storage is fixed-point metres for terrain, SI for geometry/flow. */
export const secondsPerYear = 365.25 * 24 * 60 * 60;
export const depthRateToDischarge = (millimetresPerYear: number, area: number) =>
  (MapScale.metres(millimetresPerYear, "mm") * area) / secondsPerYear;

/** Hydraulic geometry of a natural alluvial channel; dimensions are metres. */
export function channelDimensions(discharge: number, slope: number, bank: number, scale: MapScale) {
  const q = Math.max(0, discharge) / scale.volume(1.5625e-20);
  const gradient = Math.max(0.00001, slope);
  const width =
    (scale.length(1.125e-6) *
      Math.sqrt(q) *
      Math.max(0.6, Math.min(1.6, (0.001 / gradient) ** 0.08))) /
    bank ** 0.15;
  const depth = scale.length(8.75e-8) * q ** 0.3 * bank ** 0.1;
  return { width, depth };
}
