import type { PhysicalMesh } from "./mesh";
import { meshPoint } from "./mesh";
import { tectonicGeometryTravelFraction } from "./tectonicControls";

type Point = [number, number];
type Velocity = (x: number, y: number) => number;
/** Midpoint integration resolves the velocity field at the terrain cell scale. */
export function geologicalPointMotion(
  mesh: PhysicalMesh,
  vx: Velocity,
  vy: Velocity,
  distance: number,
  maximumSpeed: number
) {
  const steps = Math.max(
      1,
      Math.ceil((distance * maximumSpeed) / (1000 * mesh.spacing * tectonicGeometryTravelFraction))
    ),
    step = distance / steps;
  return (x: number, y: number): Point => {
    for (let i = 0; i < steps; i++) {
      const [mx, my] = meshPoint(mesh, x + (vx(x, y) * step) / 2000, y + (vy(x, y) * step) / 2000);
      [x, y] = meshPoint(mesh, x + (vx(mx, my) * step) / 1000, y + (vy(mx, my) * step) / 1000);
    }
    return [x, y];
  };
}
