import type { PhysicalMesh } from "./mesh";
import { meshPoint } from "./mesh";
import { tectonicGeometryTravelFraction } from "./tectonicControls";
import { MapScale, requireThat, spatial, unwrapCoordinates } from "@atlas/domain";

type Point = [number, number];
type Velocity = (x: number, y: number) => Point;
/** Midpoint integration resolves local motion; quiet ground does not pay for a distant fast plate. */
export function geologicalPointMotion(mesh: PhysicalMesh, velocity: Velocity, distance: number) {
  requireThat(
    Number.isFinite(distance) && distance >= 0,
    "point_motion",
    "Motion distance must be finite and nonnegative."
  );
  const travel = MapScale.fromBounds(mesh.bounds, mesh.spacing).cells(
    tectonicGeometryTravelFraction
  );
  return (x: number, y: number): Point => {
    let remaining = distance;
    while (remaining > 0) {
      const [vx, vy] = velocity(x, y);
      if (vx === 0 && vy === 0) break;
      const moved = midpointStep(mesh, velocity, [x, y], [vx, vy], remaining, travel);
      requireThat(
        remaining - moved.step < remaining,
        "point_resolution",
        "Motion step is below numerical resolution."
      );
      remaining -= moved.step;
      [x, y] = moved.point;
    }
    return [x, y];
  };
}

function midpointStep(
  mesh: PhysicalMesh,
  velocity: Velocity,
  point: Point,
  initial: Point,
  remaining: number,
  travel: number
) {
  let step = Math.min(remaining, (travel * 1000) / Math.hypot(...initial));
  for (;;) {
    const middle = meshPoint(
        mesh,
        point[0] + (initial[0] * step) / 2000,
        point[1] + (initial[1] * step) / 2000
      ),
      [vx, vy] = velocity(...middle),
      dx = (vx * step) / 1000,
      dy = (vy * step) / 1000,
      moved = Math.hypot(dx, dy);
    requireThat(
      Number.isFinite(moved) && step > 0,
      "point_resolution",
      "Motion must resolve a finite step."
    );
    if (moved <= travel) return { step, point: meshPoint(mesh, point[0] + dx, point[1] + dy) };
    // A faster midpoint requires another local step, not a global limit on every point.
    step /= 2;
  }
}

/** Resolve bends below a terrain cell, then remove detail compressed by the motion itself. */
export function advectGeologicalTrace(
  mesh: PhysicalMesh,
  coordinates: Point[],
  move: (x: number, y: number) => Point
): Point[] {
  if (coordinates.length < 2) return coordinates.map(([x, y]) => move(x, y));
  const scale = MapScale.fromBounds(mesh.bounds, mesh.spacing),
    deviation = scale.cells(0.125),
    spacing = mesh.periodic
      ? Math.min(scale.cells(0.5), mesh.periodic.width / 4)
      : scale.cells(0.5),
    trace = (points: Point[]) => ({
      type: "LineString" as const,
      coordinates: unwrapCoordinates(points, mesh.periodic?.width),
    }),
    sampled = spatial.resampleTrace(trace(coordinates), deviation, spacing),
    moved = sampled.coordinates.map(([x, y]) => move(...meshPoint(mesh, x, y))),
    // Wrapped endpoints alone cannot distinguish a long reach from its short seam crossing.
    reduced = spatial.resampleTrace(trace(moved), deviation, mesh.periodic ? spacing : undefined);
  return reduced.coordinates.map(([x, y]) => meshPoint(mesh, x, y));
}
