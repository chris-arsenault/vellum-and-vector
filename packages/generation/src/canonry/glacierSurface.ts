// GlacierSurface.cs, Canonry 0f62584c.
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
export function refreshGrounding(map: PhysicalField, p: PhysicalProfile) {
  for (let i = 0; i < map.mesh.count; i++) map.GroundedIce.set(i, isGrounded(map, i, p) ? 1 : 0);
}
