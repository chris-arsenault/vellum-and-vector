import type { Geometry, LineString, MultiLineString } from "geojson";
import type { Bounds, Position } from "@atlas/domain";
import { GeosSpatial } from "./geosSpatial";
import type { GeometryKernel } from "./geometryKernel";
import { createSpatialIndex } from "./spatialIndex";
import { rustSpatialBulk } from "./rustSpatialBulk";

type Overlay = "intersection" | "difference" | "union";
type Predicate = "covers" | "intersects";
const geometry = (value: string) => JSON.parse(value) as Geometry;
const point = (value: string): Position => {
  const [x, y, z = 0] = JSON.parse(value) as number[];
  return { x, y, z };
};
const coordinates = ({ x, y, z }: Position) => [x, y, z];
const positions = (value: string): Position[] =>
  (JSON.parse(value) as number[][]).map(([x, y, z = 0]) => ({ x, y, z }));
function trace(value: string): LineString | MultiLineString {
  const result = geometry(value);
  if (result.type !== "LineString" && result.type !== "MultiLineString")
    throw new Error("Trace clipping requires a LineString or MultiLineString");
  return result;
}
function line(value: string): LineString {
  const result = trace(value);
  if (result.type !== "LineString") throw new Error("Trace resampling requires a LineString");
  return result;
}

/** Worker capability consumed by Rust's BrowserGeos, outside the frontend map facade. */
export function rustSpatial(kernel: GeometryKernel, precision: number) {
  const spatial = new GeosSpatial(kernel, precision);
  return {
    ...rustSpatialBulk(kernel, spatial, precision),
    canonical: (value: string) => JSON.stringify(spatial.canonical(geometry(value))),
    area: (value: string) => spatial.area(geometry(value)),
    length: (value: string) => spatial.length(geometry(value)),
    bounds: (value: string) => JSON.stringify(spatial.bounds(geometry(value))),
    relation(a: string, b: string, predicate: Predicate) {
      if (predicate !== "covers" && predicate !== "intersects")
        throw new Error("Unknown geometry predicate");
      return spatial[predicate](geometry(a), geometry(b));
    },
    distance: (a: string, b: string) => spatial.distance(geometry(a), geometry(b)),
    overlay(a: string, b: string, operation: Overlay) {
      if (!["intersection", "difference", "union"].includes(operation))
        throw new Error("Unknown geometry overlay");
      return JSON.stringify(spatial[operation](geometry(a), geometry(b)));
    },
    unionAll: (values: string) =>
      JSON.stringify(spatial.unionAll(JSON.parse(values) as Geometry[])),
    buffer: (value: string, metres: number) =>
      JSON.stringify(spatial.buffer(geometry(value), metres)),
    clipByRect: (value: string, bounds: string) =>
      JSON.stringify(spatial.clipByRect(geometry(value), JSON.parse(bounds) as Bounds)),
    nearestPoints: (a: string, b: string) =>
      JSON.stringify(spatial.nearestPoints(geometry(a), geometry(b)).map(coordinates)),
    lineFraction: (line: string, position: string) =>
      spatial.lineFraction(geometry(line), point(position)),
    lineAt: (line: string, fraction: number) =>
      JSON.stringify(coordinates(spatial.lineAt(geometry(line), fraction))),
    interiorPosition: (value: string) =>
      JSON.stringify(coordinates(spatial.interiorPosition(geometry(value)))),
    nodeLines: (value: string) => JSON.stringify(spatial.nodeLines(geometry(value))),
    polygonize: (value: string) => JSON.stringify(spatial.polygonize(geometry(value))),
    clipTrace: (value: string, mask: string) =>
      JSON.stringify(spatial.clipTrace(trace(value), geometry(mask))),
    resampleTrace: (value: string, deviation: number, spacing?: number) =>
      JSON.stringify(spatial.resampleTrace(line(value), deviation, spacing)),
    delaunayEdges: (points: string) => JSON.stringify(spatial.delaunayEdges(positions(points))),
    voronoiCells: (points: string, bounds: string) =>
      JSON.stringify(spatial.voronoiCells(positions(points), JSON.parse(bounds) as Bounds)),
    index(values: string) {
      const index = createSpatialIndex(kernel, JSON.parse(values) as Geometry[], precision);
      return {
        query: (bounds: string) => JSON.stringify(index.query(JSON.parse(bounds) as Bounds)),
        nearest: (position: string) => index.nearest(point(position)),
        nearestMany(points: Float64Array) {
          if (points.length % 2) throw new Error("Point batches require XY pairs");
          return Int32Array.from({ length: points.length / 2 }, (_, i) =>
            index.nearest({ x: points[2 * i], y: points[2 * i + 1], z: 0 })
          );
        },
        close: index.close,
      };
    },
    coversPoints(mask: string, points: Float64Array) {
      if (points.length % 2) throw new Error("Point batches require XY pairs");
      const includes = spatial.pointCoverage(geometry(mask));
      return Uint8Array.from({ length: points.length / 2 }, (_, i) =>
        Number(includes({ x: points[2 * i], y: points[2 * i + 1], z: 0 }))
      );
    },
  };
}
