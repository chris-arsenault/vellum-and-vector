import { respond } from "../coupling/answers";
import type { PhysicalField } from "./field";
import type { PhysicalProfile } from "./profile";
import { ratio, units } from "./math";
export const supportElevation = (map: PhysicalField, i: number) =>
  map.WaterKindCodes.get(i) === 0 ? map.Elevation.get(i) : map.WaterSurfaceElevations.get(i);
export const canCarryIce = (map: PhysicalField, i: number) => {
  const water = map.WaterKindCodes.get(i);
  return water === 0 || water === 2;
};
export function isGrounded(map: PhysicalField, i: number, p: PhysicalProfile): boolean {
  const ice = map.IceThickness.get(i),
    water = map.WaterKindCodes.get(i);
  if (ice <= 0 || water === 1) return false;
  if (water === 0) return true;
  return ratio(units(ice), p.GlacierGroundingFraction, 1000) >= map.WaterDepths.get(i);
}
/**
 * How fast ice must slide to carry all that flows through a cell, in metres a year: what comes through
 * over the cross-section its thickness and the cell's width make. It grows with how far the ice has
 * gathered, not with the size of the cell. Ice with no way out carries nothing through.
 */
export function slidingSpeed(map: PhysicalField, i: number) {
  const thickness = map.IceThickness.get(i);
  if (thickness <= 0 || map.IceFlowTargets.get(i) < 0) return 0;
  return map.IceFlux.get(i) / (thickness * map.mesh.spacing);
}
/**
 * How far ice can lower its bed, in height units, while it still slides on it. It lifts off and floats
 * once the water over the bed is deeper than it can displace, and it stops sliding once its surface
 * has come down level with the surface it flows to, since it is that fall that drives it.
 */
export function iceCanCut(map: PhysicalField, i: number, p: PhysicalProfile) {
  const thickness = units(map.IceThickness.get(i)),
    water = map.WaterKindCodes.get(i) === 2 ? supportElevation(map, i) : map.EffectiveSeaLevel,
    floats = water - ratio(thickness, p.GlacierGroundingFraction, 1000),
    toFloating = map.Elevation.get(i) - floats,
    target = map.IceFlowTargets.get(i);
  if (target < 0) return 0;
  const there = supportElevation(map, target) + units(map.IceThickness.get(target)),
    toLevel = supportElevation(map, i) + thickness - there;
  return Math.max(0, Math.min(toFloating, toLevel));
}
export function refreshGrounding(map: PhysicalField, p: PhysicalProfile) {
  for (let i = 0; i < map.mesh.count; i++) map.GroundedIce.set(i, isGrounded(map, i, p) ? 1 : 0);
}
/** Plain ice bites its bed as ice does; what else is in the ice says how much harder. */
respond({ key: "iceBite", by: "plain ice", reads: [], base: () => 1 });
