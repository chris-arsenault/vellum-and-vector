import type { Geometry, LineString, MultiLineString, Position as Coordinate } from "geojson";
import type { Frame, Position } from "./model";
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
  | "withClipByRect"
  | "clipTrace"
  | "resampleTrace"
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
/** Installed once by an execution adapter; domain code never owns native handles. */
export declare function configureSpatial(factory?: (precision: number) => SpatialOperations): void;
export declare class Spatial {
  readonly precision: number;
  constructor(precision?: number);
  canonical(value: Geometry): Geometry;
  delaunayEdges(points: Position[]): [number, number][];
  covers(a: Geometry, b: Geometry): boolean;
  geometryCoverage(value: Geometry): (geometry: Geometry) => boolean;
  /** Reduce sub-resolution bends, optionally spacing stations for a sampled field; endpoints remain. */
  resampleTrace(value: LineString, deviation: number, spacing?: number): LineString;
  pointCoverage(value: Geometry): (position: Position) => boolean;
  intersects(a: Geometry, b: Geometry): boolean;
  intersectionPredicate(value: Geometry): (geometry: Geometry) => boolean;
  /** Reuse a validated mask while clipping many independent geometries. */
  intersectionWith(mask: Geometry): (geometry: Geometry) => Geometry | null;
  distance(a: Geometry, b: Geometry): number;
  area(value: Geometry): number;
  length(value: Geometry): number;
  intersection(a: Geometry, b: Geometry): Geometry | null;
  intersectionArea(value: Geometry): (geometry: Geometry) => number;
  difference(a: Geometry, b: Geometry): Geometry | null;
  differenceFrom(value: Geometry): (geometry: Geometry) => Geometry | null;
  union(a: Geometry, b: Geometry): Geometry;
  unionAll(values: Geometry[]): Geometry;
  nodeLines(value: Geometry): Geometry;
  polygonize(value: Geometry): Geometry[];
  polygonizeArea(
    boundaries: Iterable<Coordinate[]>,
    includes: (point: Position) => boolean
  ): Geometry | null;
  buffer(value: Geometry, metres: number): Geometry | null;
  bounds(value: Geometry): Bounds;
  interiorPosition(value: Geometry): Position;
  crossings(value: Geometry, footprint: Geometry): Position[];
  clipByRect(value: Geometry, bounds: Bounds): Geometry | null;
  /** Parse once for repeated windows; the clip function is valid only during the synchronous callback. */
  withClipByRect<T>(value: Geometry, work: (clip: (bounds: Bounds) => Geometry | null) => T): T;
  /** Clip an ordered trace, preserving revisits and boundary contacts without noding crossings. */
  clipTrace(value: LineString | MultiLineString, mask: Geometry): Geometry | null;
  /** The closest pair of points, first on `a`, then on `b`. */
  nearestPoints(a: Geometry, b: Geometry): [Position, Position];
  /** The fraction of a line's length at its point closest to `position`. */
  lineFraction(line: Geometry, position: Position): number;
  lineAt(line: Geometry, fraction: number): Position;
  /** Voronoi cells in site order, clipped to `bounds`. */
  voronoiCells(sites: Position[], bounds: Bounds): (Geometry | null)[];
  /** The index is released when `work` returns. */
  withIndex<T>(geometries: Geometry[], work: (index: SpatialIndex) => T): T;
}
export declare const spatial: Spatial;
export declare const point: (p: Position) => Geometry;
export declare const rectangle: ([x0, y0, x1, y1]: Bounds) => Geometry;
export declare function toWorld(frame: Frame, local: Position): Position;
export declare function fromWorld(frame: Frame, world: Position): Position;
export declare function transformGeometry(
  geometry: Geometry,
  frame: Frame,
  inverse?: boolean
): Geometry;
