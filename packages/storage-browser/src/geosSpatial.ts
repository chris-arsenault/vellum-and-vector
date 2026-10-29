import type { Geometry, Position as Coordinate } from "geojson";
import {
  requireThat,
  type Bounds,
  type Position,
  type SpatialIndex,
  type SpatialOperations,
} from "@atlas/domain";
import type { GeometryKernel } from "./geometryKernel";
import { contourArea } from "./contourArea";
import * as native from "./nativeOperations";

let sequence = 0;
/** Native spatial adapter shared by domain commands, generation and worker rendering. */
export class GeosSpatial implements SpatialOperations {
  constructor(
    private kernel: GeometryKernel,
    private precision: number
  ) {}
  canonical(value: Geometry) {
    return this.kernel.canonical(value, this.precision);
  }
  covers(a: Geometry, b: Geometry) {
    return this.kernel.relation(a, b, this.precision, "covers");
  }
  intersects(a: Geometry, b: Geometry) {
    return this.kernel.relation(a, b, this.precision, "intersects");
  }
  geometryCoverage(value: Geometry) {
    return this.predicate(value, "covers");
  }
  intersectionPredicate(value: Geometry) {
    return this.predicate(value, "intersects");
  }
  private predicate(value: Geometry, kind: "covers" | "intersects") {
    const bytes = this.kernel.encode(value, this.precision).bytes,
      key = `domain:${++sequence}`;
    // The prepared mask was validated on entry; each query shape is read-only and trusted.
    return (other: Geometry) =>
      this.kernel.withShape(other, this.precision, (target) =>
        this.kernel.matches(key, bytes, target, kind)
      );
  }
  pointCoverage(value: Geometry) {
    const bytes = this.kernel.encode(value, this.precision).bytes,
      key = `points:${++sequence}`;
    return (position: Position) => {
      requireThat(
        [position.x, position.y, position.z].every(Number.isFinite),
        "invalid_geometry",
        "Point coordinates must be finite."
      );
      return this.kernel.matchesPoint(
        key,
        bytes,
        Math.round(position.x / this.precision) * this.precision,
        Math.round(position.y / this.precision) * this.precision
      );
    };
  }
  area(value: Geometry) {
    return this.kernel.measure(value, this.precision).area;
  }
  length(value: Geometry) {
    return this.kernel.measure(value, this.precision).length;
  }
  bounds(value: Geometry) {
    return this.kernel.withShape(value, this.precision, (shape) => this.kernel.bounds(shape));
  }
  intersection(a: Geometry, b: Geometry) {
    return this.kernel.overlay(a, b, this.precision, "intersection");
  }
  difference(a: Geometry, b: Geometry) {
    return this.kernel.overlay(a, b, this.precision, "difference");
  }
  union(a: Geometry, b: Geometry) {
    return this.kernel.overlay(a, b, this.precision, "union")!;
  }
  intersectionArea(mask: Geometry) {
    const apply = this.maskOverlay(mask, "intersection");
    return (value: Geometry) => apply(value, true) as number;
  }
  differenceFrom(mask: Geometry) {
    const apply = this.maskOverlay(mask, "difference");
    return (value: Geometry) => apply(value, false) as Geometry | null;
  }
  private maskOverlay(mask: Geometry, operation: "intersection" | "difference") {
    const bytes = this.kernel.encode(mask, this.precision).bytes,
      key = `overlay:${++sequence}`;
    return (value: Geometry, area: boolean) =>
      this.kernel.withGeometry(value, this.precision, (input) =>
        this.kernel.withPrepared(key, bytes, (held) => {
          const g = this.kernel.native,
            intersects = g.GEOSPreparedIntersects(held.prepared, input);
          requireThat(intersects !== 2, "geometry_predicate", "Geometry query failed.");
          if (!intersects) return area ? 0 : value;
          const result =
            operation === "intersection"
              ? g.GEOSIntersectionPrec(input, held.geometry, this.precision)
              : g.GEOSDifferencePrec(input, held.geometry, this.precision);
          requireThat(result, "geometry_overlay", "Could not construct the geographic overlay.");
          try {
            return area
              ? this.nativeArea(result)
              : g.GEOSisEmpty(result)
                ? null
                : this.kernel.json(result);
          } finally {
            g.GEOSGeom_destroy(result);
          }
        })
      );
  }
  private nativeArea(geometry: number) {
    const g = this.kernel.native,
      output = g.Module._malloc(8);
    try {
      requireThat(g.GEOSArea(geometry, output), "geometry_measure", "Could not measure area.");
      return g.Module.getValue(output, "double");
    } finally {
      g.Module._free(output);
    }
  }
  private unary(value: Geometry, operation: (input: number) => number): Geometry | null {
    const g = this.kernel.native;
    return this.kernel.withGeometry(value, this.precision, (input) => {
      const result = operation(input);
      requireThat(result, "geometry_operation", "Could not construct geographic geometry.");
      try {
        return g.GEOSisEmpty(result) ? null : this.kernel.json(result);
      } finally {
        g.GEOSGeom_destroy(result);
      }
    });
  }
  unionAll(geometries: Geometry[]) {
    requireThat(geometries.length, "invalid_geometry", "Union requires at least one geometry.");
    return this.nodeLines({ type: "GeometryCollection", geometries });
  }
  nodeLines(value: Geometry) {
    return this.unary(value, (input) =>
      this.kernel.native.GEOSUnaryUnionPrec(input, this.precision)
    )!;
  }
  polygonize(value: Geometry): Geometry[] {
    const result = this.kernel.polygonize(this.nodeLines(value), this.precision);
    return result.type === "GeometryCollection" ? result.geometries : [result];
  }
  polygonizeArea(boundaries: Iterable<Coordinate[]>, includes: (point: Position) => boolean) {
    return contourArea(this.kernel, this.precision, boundaries, includes);
  }
  buffer(value: Geometry, distance: number) {
    return this.kernel.buffer(value, distance, this.precision);
  }
  interiorPosition(value: Geometry): Position {
    const result = this.unary(value, (input) => this.kernel.native.GEOSPointOnSurface(input));
    requireThat(result?.type === "Point", "geometry_interior", "Geometry needs an interior point.");
    return { x: result.coordinates[0], y: result.coordinates[1], z: 0 };
  }
  distance(a: Geometry, b: Geometry) {
    const g = this.kernel.native,
      output = g.Module._malloc(8);
    try {
      return this.kernel.withGeometry(a, this.precision, (left) =>
        this.kernel.withGeometry(b, this.precision, (right) => {
          requireThat(
            g.GEOSDistance(left, right, output),
            "geometry_distance",
            "Could not measure geographic distance."
          );
          return g.Module.getValue(output, "double");
        })
      );
    } finally {
      g.Module._free(output);
    }
  }
  clipByRect(value: Geometry, bounds: Bounds) {
    return native.clipByRect(this.kernel, value, bounds, this.precision);
  }
  nearestPoints(a: Geometry, b: Geometry): [Position, Position] {
    const [p, q] = native.nearestPoints(this.kernel, a, b, this.precision);
    return [
      { x: p[0], y: p[1], z: 0 },
      { x: q[0], y: q[1], z: 0 },
    ];
  }
  lineFraction(line: Geometry, position: Position) {
    return native.project(this.kernel, line, position.x, position.y, this.precision);
  }
  lineAt(line: Geometry, fraction: number): Position {
    const [x, y, z = 0] = native.interpolate(
      this.kernel,
      line,
      fraction,
      this.precision
    ).coordinates;
    return { x, y, z };
  }
  voronoiCells(sites: Position[], bounds: Bounds) {
    return native.voronoi(
      this.kernel,
      sites.map((p) => [p.x, p.y]),
      bounds,
      this.precision
    );
  }
  withIndex<T>(geometries: Geometry[], work: (index: SpatialIndex) => T): T {
    const g = this.kernel.native,
      tree = native.strtree(this.kernel),
      owned: number[] = [];
    try {
      for (const value of geometries) {
        const geometry = this.kernel.withShape(value, this.precision, (shape) =>
          g.GEOSGeom_clone(shape)
        );
        owned.push(geometry);
        tree.insert(geometry);
      }
      return work({
        query: (bounds) => this.kernel.withRectangle(bounds, tree.query),
        nearest: (p) => this.kernel.withRectangle([p.x, p.y, p.x, p.y], tree.nearest),
      });
    } finally {
      tree.close();
      for (const geometry of owned) g.GEOSGeom_destroy(geometry);
    }
  }
  crossings(value: Geometry, footprint: Geometry): Position[] {
    const boundary = this.unary(footprint, (input) => this.kernel.native.GEOSBoundary(input));
    const shape = boundary && this.intersection(value, boundary);
    if (!shape) return [];
    const points = coordinates(shape),
      unique = new Map<string, Position>();
    for (const p of points) unique.set(`${p[0]},${p[1]}`, { x: p[0], y: p[1], z: 0 });
    return [...unique.values()];
  }
  delaunayEdges(points: Position[]): [number, number][] {
    const key = (x: number, y: number) =>
      `${Math.round(x / this.precision)}:${Math.round(y / this.precision)}`;
    const indices = new Map(points.map((p, i) => [key(p.x, p.y), i]));
    if (indices.size < 2) return [];
    const result = this.unary(
      { type: "MultiPoint", coordinates: points.map((p) => [p.x, p.y]) },
      (input) => this.kernel.native.GEOSDelaunayTriangulation(input, 0, 1)
    );
    requireThat(
      result?.type === "MultiLineString",
      "geometry_triangulation",
      "Could not connect geographic sites."
    );
    return result.coordinates.map(([a, b]) => [
      indices.get(key(a[0], a[1]))!,
      indices.get(key(b[0], b[1]))!,
    ]);
  }
}
function coordinates(geometry: Geometry): Coordinate[] {
  if (geometry.type === "GeometryCollection") return geometry.geometries.flatMap(coordinates);
  if (geometry.type === "Point") return [geometry.coordinates];
  if (geometry.type === "LineString" || geometry.type === "MultiPoint") return geometry.coordinates;
  if (geometry.type === "Polygon" || geometry.type === "MultiLineString")
    return geometry.coordinates.flat();
  return geometry.coordinates.flat(2);
}
