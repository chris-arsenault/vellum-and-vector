// GlacierSurface.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalProfile } from "./profile";
import { ratio, units } from "./math";
export const supportElevation = (map: PhysicalField, i: number) =>
  map.WaterKindCodes[i] === 0 ? map.Elevation[i] : map.WaterSurfaceElevations[i];
export const canCarryIce = (map: PhysicalField, i: number) =>
  map.WaterKindCodes[i] === 0 || map.WaterKindCodes[i] === 2;
export function isGrounded(map: PhysicalField, i: number, p: PhysicalProfile): boolean {
  if (map.IceThickness[i] <= 0 || map.WaterKindCodes[i] === 1) return false;
  if (map.WaterKindCodes[i] === 0) return true;
  return ratio(units(map.IceThickness[i]), p.GlacierGroundingFraction, 1000) >= map.WaterDepths[i];
}
export function refreshGrounding(map: PhysicalField, p: PhysicalProfile) {
  for (let i = 0; i < map.mesh.count; i++) map.GroundedIce[i] = isGrounded(map, i, p) ? 1 : 0;
}
