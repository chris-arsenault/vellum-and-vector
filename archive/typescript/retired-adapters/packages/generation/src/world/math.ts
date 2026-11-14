// Ported from Canonry 0f62584c: PhysicalElevation, PhysicalCrust and PhysicalRock.
import { hardestRock, softestRock } from "../rock/rockCatalogue";
import { MapScale } from "@atlas/domain";

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
export const units = MapScale.native;
export const toUnits = (value: number) => round(MapScale.metres(value, "native"));
export const scaled = (value: number, scale: number) => units(value * scale);
export const ratio = (value: number, numerator: number, denominator: number) =>
  truncate((value * numerator) / denominator);
export const noWaterSurface = -(2 ** 63);
export const buoyancy = (fraction: number) => 300 + 400 * clamp(fraction, 0, 1);
// Rock on the crust sinks by about its density over the mantle's. A strong plate carries a load
// narrower than the flexure length, so narrow ranges stand and broad plateaus sink.
export const rockLoadResponsePerMille = 800;
/**
 * How much of the model's crust column weighs the same as a metre of rock. A unit of column lifts the
 * ground by its buoyancy and a metre of rock presses it down by the load response, so moving rock
 * between the two by this measure leaves what the ground floats at as it was.
 */
export const crustPerRock = (fraction: number) =>
  (1 - rockLoadResponsePerMille / 1000) / (buoyancy(fraction) / 1000);
// Model crust dimensions share the map's scale, including reserves and newly opened crust.
export const crustFoundation = (fraction: number, scale: MapScale) =>
  scale.length(0.00025 + 0.00075 * clamp(fraction, 0, 1));
export function crustHeight(value: number, continentalFraction: number, scale: MapScale): number {
  const fraction = clamp(continentalFraction, 0, 1);
  const foundation = crustFoundation(fraction, scale);
  return (
    scale.length(-0.00005 + 0.0001 * fraction) + ((value - foundation) * buoyancy(fraction)) / 1000
  );
}
export const rockResistance = (value: number) => clamp(value, softestRock, hardestRock);
