import type { Geometry } from "geojson";
import GeoJSONReader from "jsts/org/locationtech/jts/io/GeoJSONReader.js";
import GeoJSONWriter from "jsts/org/locationtech/jts/io/GeoJSONWriter.js";
import GeometryFactory from "jsts/org/locationtech/jts/geom/GeometryFactory.js";
import Coordinate from "jsts/org/locationtech/jts/geom/Coordinate.js";
import Orientation from "jsts/org/locationtech/jts/algorithm/Orientation.js";
import Polygonizer from "jsts/org/locationtech/jts/operation/polygonize/Polygonizer.js";
import UnaryUnionOp from "jsts/org/locationtech/jts/operation/union/UnaryUnionOp.js";
import InteriorPointArea from "jsts/org/locationtech/jts/algorithm/InteriorPointArea.js";

type Point = [number, number];
function between(a: Point, b: Point, c: Point) {
  return (
    b[0] >= Math.min(a[0], c[0]) &&
    b[0] <= Math.max(a[0], c[0]) &&
    b[1] >= Math.min(a[1], c[1]) &&
    b[1] <= Math.max(a[1], c[1]) &&
    Orientation.index(new Coordinate(...a), new Coordinate(...b), new Coordinate(...c)) === 0
  );
}
/** Remove only redundant vertices; reversals and every noncollinear turn survive. */
export function compactContour(ring: Point[]): Point[] {
  const result: Point[] = [];
  for (const point of ring) {
    const last = result.at(-1);
    if (last && last[0] === point[0] && last[1] === point[1]) continue;
    while (result.length > 1 && between(result.at(-2)!, result.at(-1)!, point)) result.pop();
    result.push(point);
  }
  return result;
}
function hasArea(ring: Point[]) {
  const a = ring[0],
    b = ring.find((p) => p[0] !== a[0] || p[1] !== a[1]);
  return (
    b &&
    ring.some(
      (c) =>
        Orientation.index(new Coordinate(...a), new Coordinate(...b), new Coordinate(...c)) !== 0
    )
  );
}
export function polygonize(
  boundaries: Point[][],
  at: (x: number, y: number) => number,
  level: number
): Geometry | null {
  const compact = boundaries
    .map(compactContour)
    .filter((ring) => ring.length >= 4 && hasArea(ring));
  if (!compact.length) return null;
  const reader = new GeoJSONReader(new GeometryFactory()),
    writer = new GeoJSONWriter();
  const lines = reader.read({ type: "MultiLineString", coordinates: compact });
  // Exact-level plateaus can make closed walks touch or retrace an outer edge.
  const polygonizer = new Polygonizer();
  polygonizer.add(UnaryUnionOp.union(lines));
  const polygons: Geometry[] = [];
  for (const polygon of polygonizer.getPolygons().toArray()) {
    const probe = InteriorPointArea.getInteriorPoint(polygon);
    if (at(probe.x, probe.y) > level) polygons.push(writer.write(polygon) as Geometry);
  }
  if (!polygons.length) return null;
  return writer.write(
    UnaryUnionOp.union(reader.read({ type: "GeometryCollection", geometries: polygons }))
  ) as Geometry;
}
