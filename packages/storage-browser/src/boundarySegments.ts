import type { Geometry, Position } from "geojson";
import type { Bounds } from "@atlas/domain";

export interface BoundarySegment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}
function linesOf(geometry: Exclude<Geometry, { type: "GeometryCollection" }>): Position[][] {
  switch (geometry.type) {
    case "Polygon":
    case "MultiLineString":
      return geometry.coordinates;
    case "MultiPolygon":
      return geometry.coordinates.flat();
    case "LineString":
      return [geometry.coordinates];
    default:
      return [];
  }
}
export function* boundarySegments(geometry: Geometry): Generator<BoundarySegment> {
  if (geometry.type === "GeometryCollection") {
    for (const part of geometry.geometries) yield* boundarySegments(part);
    return;
  }
  for (const line of linesOf(geometry))
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = line[i - 1],
        [bx, by] = line[i];
      if (ax !== bx || ay !== by) yield { ax, ay, bx, by };
    }
}
export function segmentBounds(s: BoundarySegment): Bounds {
  return [Math.min(s.ax, s.bx), Math.min(s.ay, s.by), Math.max(s.ax, s.bx), Math.max(s.ay, s.by)];
}
export function segmentLine(s: BoundarySegment): [number, number][] {
  return [
    [s.ax, s.ay],
    [s.bx, s.by],
  ];
}
export function pointKey(x: number, y: number, precision: number) {
  return `${Math.round(x / precision)},${Math.round(y / precision)}`;
}
export function edgeKey(s: BoundarySegment, precision: number) {
  const a = pointKey(s.ax, s.ay, precision),
    b = pointKey(s.bx, s.by, precision);
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}
export function rayCrossing(s: BoundarySegment, x: number, y: number) {
  if (s.ay > y === s.by > y) return null;
  const hit = s.ax + ((y - s.ay) * (s.bx - s.ax)) / (s.by - s.ay);
  return hit >= x ? hit : null;
}
