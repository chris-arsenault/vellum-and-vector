/** Numerical storage is fixed-point metres for terrain, SI for geometry/flow. */
export const secondsPerYear = 365.25 * 24 * 60 * 60;
export const depthRateToDischarge = (millimetresPerYear: number, area: number) =>
  (millimetresPerYear * area) / (1000 * secondsPerYear);

/** Hydraulic geometry of a natural alluvial channel; dimensions are metres. */
export function channelDimensions(discharge: number, slope: number, resistance: number) {
  const q = Math.max(0, discharge);
  const gradient = Math.max(0.00001, slope);
  const bank = Math.max(0.5, Math.min(2, resistance / 1000));
  const width =
    (4.5 * Math.sqrt(q) * Math.max(0.6, Math.min(1.6, (0.001 / gradient) ** 0.08))) / bank ** 0.15;
  const depth = 0.35 * q ** 0.3 * bank ** 0.1;
  return { width, depth };
}
