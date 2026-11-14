import type { PhysicalField } from "../world/field";
import { columnFields } from "@atlas/domain";
import { projectGround } from "./groundShares";
import { groundStorage } from "./groundStorage";

export type Deformation = readonly [number, number, number, number];
/** Transform axial clast fabric with actual horizontal motion; translation has identity F. */
export function deformFabric(x: number, y: number, f: Deformation): readonly [number, number] {
  const coherence = Math.hypot(x, y);
  if (coherence <= 0) return [0, 0];
  const angle = Math.atan2(y, x) / 2,
    tx = f[0] * Math.cos(angle) + f[1] * Math.sin(angle),
    ty = f[2] * Math.cos(angle) + f[3] * Math.sin(angle),
    length = Math.hypot(tx, ty);
  return length > 1e-12
    ? [
        (coherence * (tx * tx - ty * ty)) / (length * length),
        (coherence * 2 * tx * ty) / (length * length),
      ]
    : [0, 0];
}
/** Bed elevation is a scalar: its slope transforms by the inverse transpose of horizontal motion. */
export function deformSlope(x: number, y: number, f: Deformation): readonly [number, number] {
  const determinant = f[0] * f[3] - f[1] * f[2];
  // A collapsed footprint cannot resolve a new plane; retain its last resolved slope.
  if (Math.abs(determinant) <= 1e-12) return [x, y];
  return [(f[3] * x - f[2] * y) / determinant, (f[0] * y - f[1] * x) / determinant];
}
/** Horizontal motion changes every retained plane and fabric without changing formation history. */
export function deformGround(map: PhysicalField, cell: number, f: Deformation) {
  const stored = groundStorage(map);
  for (const column of Object.values(columnFields))
    for (let slot = 0; slot < column.kind.length; slot++) {
      const [x, y] = deformFabric(
        map[column.grainX[slot]].get(cell),
        map[column.grainY[slot]].get(cell),
        f
      );
      const [sx, sy] = deformSlope(
        map[column.bedSlopeX[slot]].get(cell),
        map[column.bedSlopeY[slot]].get(cell),
        f
      );
      stored[column.grainX[slot]].set(cell, x);
      stored[column.grainY[slot]].set(cell, y);
      stored[column.bedSlopeX[slot]].set(cell, sx);
      stored[column.bedSlopeY[slot]].set(cell, sy);
    }
  projectGround(map, cell);
}
