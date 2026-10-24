// Ported from Canonry 0f62584c: PhysicalElevation, PhysicalCrust and PhysicalRock.
export const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function round(value: number): number {
  const result = Math.sign(value) * Math.round(Math.abs(value));
  return result === 0 ? 0 : result;
}
export function truncate(value: number): number {
  const result = Math.trunc(value);
  return result === 0 ? 0 : result;
}
export const units = (value: number) => round(value * 1024);
export const toUnits = (value: number) => round(value / 1024);
export const scaled = (value: number, scale: number) => units(clamp(value, -2, 2) * scale);
export const ratio = (value: number, numerator: number, denominator: number) =>
  truncate((value * numerator) / denominator);
export const noWaterSurface = -(2 ** 63);
export const buoyancy = (fraction: number) => 300 + 400 * clamp(fraction, 0, 1);
// Metres of the model's crust column. Continental foundation is 4,000; buoyancy lifts each
// metre above it by 0.7, so the ceiling bounds isostatic height at about 7,200 m (ADR 0005 plan).
export const minimumCrustThickness = 800;
export const maximumCrustThickness = 14_000;
// Metres above or below the datum that bedrock, support targets and constructed surfaces may reach.
export const elevationLimit = 8000;
export const thickness = (value: number) =>
  clamp(value, minimumCrustThickness, maximumCrustThickness);
export function crustHeight(value: number, continentalFraction: number): number {
  const fraction = clamp(continentalFraction, 0, 1);
  const foundation = 1000 + 3000 * fraction;
  return -200 + 400 * fraction + ((thickness(value) - foundation) * buoyancy(fraction)) / 1000;
}
export const rockResistance = (value: number) => clamp(value, 250, 4000);
