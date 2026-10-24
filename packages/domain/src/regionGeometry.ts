import type { Geometry, LineString, Polygon, Position } from "geojson";
import GeoJSONReader from "jsts/org/locationtech/jts/io/GeoJSONReader.js";
import GeoJSONWriter from "jsts/org/locationtech/jts/io/GeoJSONWriter.js";
import GeometryFactory from "jsts/org/locationtech/jts/geom/GeometryFactory.js";
import Polygonizer from "jsts/org/locationtech/jts/operation/polygonize/Polygonizer.js";
import UnaryUnionOp from "jsts/org/locationtech/jts/operation/union/UnaryUnionOp.js";
import { spatial, point, type Bounds } from "./spatial";
import { usefulRegionSize } from "./regionViews";

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
/** Node shared river/shore/territory/cut edges once, then assemble enclosed faces. */
export function regionFaces(footprint: Geometry, boundaries: Geometry[]): Polygon[] {
  const reader = new GeoJSONReader(new GeometryFactory()),
    writer = new GeoJSONWriter();
  const lines = [...regionBoundaryLines(footprint), ...boundaries.flatMap(regionBoundaryLines)];
  const polygonizer = new Polygonizer();
  polygonizer.add(
    UnaryUnionOp.union(
      reader.read({
        type: "MultiLineString",
        coordinates: lines.map((line) => line.coordinates),
      })
    )
  );
  const result: Polygon[] = [];
  for (const shape of polygonizer.getPolygons().toArray()) {
    const geometry = writer.write(shape) as Polygon;
    const probe = point(spatial.interiorPosition(geometry));
    if (spatial.covers(footprint, probe)) {
      const clipped = spatial.intersection(footprint, geometry);
      if (clipped) result.push(...polygonParts(clipped).filter(usefulRegionSize));
    }
  }
  return result;
}
export function regionCandidates(
  available: Geometry,
  sources: RegionCandidate[],
  cuts: Geometry[],
  position: { x: number; y: number; z: number } | null,
  viewport: Bounds
): RegionCandidate[] {
  const result: RegionCandidate[] = [];
  const add = (name: string, geometry: Geometry) => {
    if (!spatial.intersects(available, geometry)) return;
    const clipped = spatial.intersection(available, geometry);
    if (!clipped) return;
    for (const shape of polygonParts(clipped)) {
      if (position && !spatial.covers(shape, point(position))) continue;
      if (!usefulRegionSize(shape)) continue;
      const canonical = spatial.canonical(shape);
      if (!result.some((c) => JSON.stringify(c.footprint) === JSON.stringify(canonical)))
        result.push({ name, footprint: canonical });
    }
  };
  if (!cuts.length)
    for (const source of sources.filter((s) => s.footprint.type.includes("Polygon")))
      add(source.name, source.footprint);
  const boundaries = sources.map((s) => s.footprint);
  for (const [i, face] of regionFaces(available, [...boundaries, ...cuts]).entries())
    add(`Region ${i + 1}`, face);
  const target = ((viewport[2] - viewport[0]) * (viewport[3] - viewport[1])) / 3;
  return result.sort(
    (a, b) =>
      Math.abs(Math.log(spatial.area(a.footprint) / target)) -
      Math.abs(Math.log(spatial.area(b.footprint) / target))
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
