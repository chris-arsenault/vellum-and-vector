import type { Geometry, LineString, Polygon, Position } from "geojson";

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
  const edges = boundaries
    .flatMap(regionBoundaryLines)
    .flatMap((l) => l.coordinates.slice(1).map((b, i) => [l.coordinates[i], b]));
  const nearest = (p: Position) => {
    let best = p,
      distance = tolerance;
    for (const [a, b] of edges) {
      const dx = b[0] - a[0],
        dy = b[1] - a[1];
      const t = Math.max(
        0,
        Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1))
      );
      const q = [a[0] + dx * t, a[1] + dy * t];
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d <= distance) {
        best = q;
        distance = d;
      }
    }
    return best;
  };
  return {
    ...line,
    coordinates: line.coordinates.map((p, i) =>
      i === 0 || i === line.coordinates.length - 1 ? nearest(p) : p
    ),
  };
}
