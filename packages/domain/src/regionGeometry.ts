import type { Geometry, LineString, Polygon, Position } from "geojson";
import { spatial } from "./spatial";

export interface RegionCandidate {
  name: string;
  footprint: Geometry;
}
export function polygonParts(geometry: Geometry): Polygon[] {
  if (geometry.type === "Polygon") return [geometry];
  if (geometry.type === "MultiPolygon")
    return geometry.coordinates.map((coordinates) => ({ type: "Polygon", coordinates }));
  if (geometry.type === "GeometryCollection") return geometry.geometries.flatMap(polygonParts);
  return [];
}
export function regionBoundaryLines(geometry: Geometry): LineString[] {
  if (geometry.type === "LineString") return [geometry];
  if (geometry.type === "MultiLineString")
    return geometry.coordinates.map((coordinates) => ({ type: "LineString", coordinates }));
  return polygonParts(geometry).flatMap((p) =>
    p.coordinates.map((coordinates) => ({ type: "LineString" as const, coordinates }))
  );
}
/** Snap cut endpoints to existing geographic edges at the map's current pixel tolerance. */
export function snapRegionCut(
  line: LineString,
  boundaries: Geometry[],
  tolerance: number
): LineString {
  const lines = boundaries.flatMap(regionBoundaryLines).map((l) => l.coordinates);
  if (!lines.length) return line;
  const edges: Geometry = { type: "MultiLineString", coordinates: lines };
  // GEOS clips the edges to the snap window, then finds the closest point on what remains.
  const nearest = (p: Position) => {
    const window = spatial.clipByRect(edges, [
      p[0] - tolerance,
      p[1] - tolerance,
      p[0] + tolerance,
      p[1] + tolerance,
    ]);
    if (!window) return p;
    const [q] = spatial.nearestPoints(window, { type: "Point", coordinates: [p[0], p[1]] });
    return Math.hypot(q.x - p[0], q.y - p[1]) <= tolerance ? [q.x, q.y] : p;
  };
  return {
    ...line,
    coordinates: line.coordinates.map((p, i) =>
      i === 0 || i === line.coordinates.length - 1 ? nearest(p) : p
    ),
  };
}
