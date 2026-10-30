import type { Geometry, Position as Coordinate } from "geojson";
import type { Frame, Position } from "./model";
import { frameSchema } from "./schemas";
import { requireThat } from "./errors";

export type Bounds = [number, number, number, number];
export type SpatialOperations = Pick<
  Spatial,
  | "canonical"
  | "delaunayEdges"
  | "covers"
  | "geometryCoverage"
  | "pointCoverage"
  | "intersects"
  | "intersectionPredicate"
  | "distance"
  | "area"
  | "length"
  | "intersection"
  | "intersectionWith"
  | "intersectionArea"
  | "difference"
  | "differenceFrom"
  | "union"
  | "unionAll"
  | "nodeLines"
  | "polygonize"
  | "polygonizeArea"
  | "buffer"
  | "bounds"
  | "interiorPosition"
  | "crossings"
  | "clipByRect"
  | "nearestPoints"
  | "lineFraction"
  | "lineAt"
  | "voronoiCells"
  | "withIndex"
>;
/** A native spatial index over geometries, reported by their position in the input list. */
export interface SpatialIndex {
  /** Items whose envelopes intersect `bounds`, in input order. */
  query(bounds: Bounds): number[];
  /** The item nearest to `position`, or -1 for an empty index. */
  nearest(position: Position): number;
}
let operationFactory: ((precision: number) => SpatialOperations) | undefined;
const implementations = new Map<number, SpatialOperations>();
/** Installed once by an execution adapter; domain code never owns native handles. */
export function configureSpatial(factory?: (precision: number) => SpatialOperations) {
  operationFactory = factory;
  implementations.clear();
}
function operations(precision: number) {
  requireThat(
    operationFactory,
    "spatial_engine",
    "Initialize the spatial engine before using domain geometry."
  );
  let value = implementations.get(precision);
  if (!value) {
    value = operationFactory(precision);
    implementations.set(precision, value);
  }
  return value;
}

export class Spatial {
  constructor(readonly precision = 0.000001) {
    requireThat(
      Number.isFinite(precision) && precision > 0,
      "invalid_precision",
      "Precision must be positive."
    );
  }
  canonical(value: Geometry): Geometry {
    return operations(this.precision).canonical(value);
  }
  delaunayEdges(points: Position[]): [number, number][] {
    return operations(this.precision).delaunayEdges(points);
  }
  covers(a: Geometry, b: Geometry): boolean {
    return operations(this.precision).covers(a, b);
  }
  geometryCoverage(value: Geometry): (geometry: Geometry) => boolean {
    return operations(this.precision).geometryCoverage(value);
  }
  pointCoverage(value: Geometry): (position: Position) => boolean {
    return operations(this.precision).pointCoverage(value);
  }
  intersects(a: Geometry, b: Geometry): boolean {
    return operations(this.precision).intersects(a, b);
  }
  intersectionPredicate(value: Geometry): (geometry: Geometry) => boolean {
    return operations(this.precision).intersectionPredicate(value);
  }
  /** Reuse a validated mask while clipping many independent geometries. */
  intersectionWith(mask: Geometry): (geometry: Geometry) => Geometry | null {
    return operations(this.precision).intersectionWith(mask);
  }
  distance(a: Geometry, b: Geometry): number {
    return operations(this.precision).distance(a, b);
  }
  area(value: Geometry): number {
    return operations(this.precision).area(value);
  }
  length(value: Geometry): number {
    return operations(this.precision).length(value);
  }
  intersection(a: Geometry, b: Geometry): Geometry | null {
    return operations(this.precision).intersection(a, b);
  }
  intersectionArea(value: Geometry): (geometry: Geometry) => number {
    return operations(this.precision).intersectionArea(value);
  }
  difference(a: Geometry, b: Geometry): Geometry | null {
    return operations(this.precision).difference(a, b);
  }
  differenceFrom(value: Geometry): (geometry: Geometry) => Geometry | null {
    return operations(this.precision).differenceFrom(value);
  }
  union(a: Geometry, b: Geometry): Geometry {
    return operations(this.precision).union(a, b);
  }
  unionAll(values: Geometry[]): Geometry {
    return operations(this.precision).unionAll(values);
  }
  nodeLines(value: Geometry): Geometry {
    return operations(this.precision).nodeLines(value);
  }
  polygonize(value: Geometry): Geometry[] {
    return operations(this.precision).polygonize(value);
  }
  polygonizeArea(
    boundaries: Iterable<Coordinate[]>,
    includes: (point: Position) => boolean
  ): Geometry | null {
    return operations(this.precision).polygonizeArea(boundaries, includes);
  }
  buffer(value: Geometry, metres: number): Geometry | null {
    return operations(this.precision).buffer(value, metres);
  }
  bounds(value: Geometry): Bounds {
    return operations(this.precision).bounds(value);
  }
  interiorPosition(value: Geometry): Position {
    return operations(this.precision).interiorPosition(value);
  }
  crossings(value: Geometry, footprint: Geometry): Position[] {
    return operations(this.precision).crossings(value, footprint);
  }
  clipByRect(value: Geometry, bounds: Bounds): Geometry | null {
    return operations(this.precision).clipByRect(value, bounds);
  }
  /** The closest pair of points, first on `a`, then on `b`. */
  nearestPoints(a: Geometry, b: Geometry): [Position, Position] {
    return operations(this.precision).nearestPoints(a, b);
  }
  /** The fraction of a line's length at its point closest to `position`. */
  lineFraction(line: Geometry, position: Position): number {
    return operations(this.precision).lineFraction(line, position);
  }
  lineAt(line: Geometry, fraction: number): Position {
    return operations(this.precision).lineAt(line, fraction);
  }
  /** Voronoi cells in site order, clipped to `bounds`. */
  voronoiCells(sites: Position[], bounds: Bounds): (Geometry | null)[] {
    return operations(this.precision).voronoiCells(sites, bounds);
  }
  /** The index is released when `work` returns. */
  withIndex<T>(geometries: Geometry[], work: (index: SpatialIndex) => T): T {
    return operations(this.precision).withIndex(geometries, work);
  }
}

export const spatial = new Spatial();
export const point = (p: Position): Geometry => ({
  type: "Point",
  coordinates: [p.x, p.y],
});
export const rectangle = ([x0, y0, x1, y1]: Bounds): Geometry => ({
  type: "Polygon",
  coordinates: [
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ],
  ],
});

export function toWorld(frame: Frame, local: Position): Position {
  frameSchema.parse(frame);
  const a = (frame.rotation * Math.PI) / 180;
  return {
    x: frame.origin.x + frame.metresPerUnit * (local.x * Math.cos(a) - local.y * Math.sin(a)),
    y: frame.origin.y + frame.metresPerUnit * (local.x * Math.sin(a) + local.y * Math.cos(a)),
    z: frame.origin.z + local.z * frame.metresPerUnit,
  };
}

export function fromWorld(frame: Frame, world: Position): Position {
  frameSchema.parse(frame);
  const a = (frame.rotation * Math.PI) / 180;
  const x = (world.x - frame.origin.x) / frame.metresPerUnit;
  const y = (world.y - frame.origin.y) / frame.metresPerUnit;
  return {
    x: x * Math.cos(a) + y * Math.sin(a),
    y: -x * Math.sin(a) + y * Math.cos(a),
    z: (world.z - frame.origin.z) / frame.metresPerUnit,
  };
}

function mapCoordinates(value: unknown, convert: (c: Coordinate) => Coordinate): unknown {
  requireThat(Array.isArray(value), "invalid_coordinates", "Coordinate arrays are required.");
  return typeof value[0] === "number"
    ? convert(value as Coordinate)
    : value.map((v) => mapCoordinates(v, convert));
}

export function transformGeometry(geometry: Geometry, frame: Frame, inverse = false): Geometry {
  const convert = (coordinate: Coordinate): Coordinate => {
    const p = { x: coordinate[0], y: coordinate[1], z: coordinate[2] ?? 0 };
    const result = inverse ? fromWorld(frame, p) : toWorld(frame, p);
    return coordinate.length > 2 ? [result.x, result.y, result.z] : [result.x, result.y];
  };
  if (geometry.type === "GeometryCollection")
    return {
      type: geometry.type,
      geometries: geometry.geometries.map((g) => transformGeometry(g, frame, inverse)),
    };
  return spatial.canonical({
    ...geometry,
    coordinates: mapCoordinates(geometry.coordinates, convert),
  } as Geometry);
}
