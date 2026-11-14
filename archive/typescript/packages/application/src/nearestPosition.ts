import type { Geometry } from "geojson";
import { point, spatial, type Position } from "@atlas/domain";

export function nearestPosition(geometry: Geometry, p: Position): Position {
  const [nearest] = spatial.nearestPoints(geometry, point(p));
  return { x: nearest.x, y: nearest.y, z: p.z };
}
