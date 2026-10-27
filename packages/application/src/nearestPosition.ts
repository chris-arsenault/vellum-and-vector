import type { Geometry, Position as Coordinate } from "geojson";
import type { Position } from "@atlas/domain";

function geometryLines(
  geometry: Exclude<Geometry, { type: "GeometryCollection" }>
): Coordinate[][] {
  switch (geometry.type) {
    case "Point":
      return [[geometry.coordinates]];
    case "MultiPoint":
      return geometry.coordinates.map((p) => [p]);
    case "LineString":
      return [geometry.coordinates];
    case "MultiLineString":
    case "Polygon":
      return geometry.coordinates;
    case "MultiPolygon":
      return geometry.coordinates.flat();
  }
}
function* candidates(geometry: Geometry, point: Position): Generator<Coordinate> {
  if (geometry.type === "GeometryCollection") {
    for (const part of geometry.geometries) yield* candidates(part, point);
    return;
  }
  for (const line of geometryLines(geometry)) {
    if (line.length === 1) yield line[0];
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1],
        b = line[i],
        dx = b[0] - a[0],
        dy = b[1] - a[1];
      const t = Math.max(
        0,
        Math.min(1, ((point.x - a[0]) * dx + (point.y - a[1]) * dy) / (dx * dx + dy * dy || 1))
      );
      yield [a[0] + t * dx, a[1] + t * dy];
    }
  }
}
export function nearestPosition(geometry: Geometry, point: Position): Position {
  let closest: Coordinate = [point.x, point.y],
    distance = Infinity;
  for (const p of candidates(geometry, point)) {
    const d = Math.hypot(p[0] - point.x, p[1] - point.y);
    if (d < distance) {
      distance = d;
      closest = p;
    }
  }
  return { x: closest[0], y: closest[1], z: point.z };
}
