// PhysicalRadialFieldPainter.cs, Canonry 0f62584c.
import type { PhysicalMesh } from "./mesh";
import type { NumericalVector } from "@atlas/domain";
import { round } from "./math";
import { meshDeltaX } from "./mesh";
export function paintMaximum(
  mesh: PhysicalMesh,
  field: NumericalVector,
  x: number,
  y: number,
  radius: number,
  strength: number
) {
  if (field.length !== mesh.count || radius <= 0) throw new Error("Invalid radial field extent.");
  for (let i = 0; i < mesh.count; i++) {
    const dx = meshDeltaX(mesh, mesh.x[i] - x),
      dy = mesh.y[i] - y,
      distance = dx * dx + dy * dy;
    if (distance > radius * radius) continue;
    const amount = 1 - Math.sqrt(distance) / radius;
    field[i] = Math.max(field[i], round(strength * amount * amount));
  }
}
// C# float intermediates are retained for triangle-to-triangle distances.
export function triangleDistanceSquared(mesh: PhysicalMesh, a: number, b: number): number {
  const dx = Math.fround(meshDeltaX(mesh, mesh.x[a] - mesh.x[b])),
    dy = Math.fround(mesh.y[a] - mesh.y[b]);
  return Math.fround(Math.fround(dx * dx) + Math.fround(dy * dy));
}
