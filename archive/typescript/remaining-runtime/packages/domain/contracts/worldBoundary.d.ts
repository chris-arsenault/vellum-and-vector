import type { Geometry, Position as Coordinate } from "geojson";
import type { Position, World } from "./model";
import { type Bounds } from "./spatial";
export interface WorldReference {
  id: string;
  domain: Geometry;
  topology: string;
  boundaryMode?: "cylinder" | "ocean" | "none";
  units: string;
  axes: string;
  verticalDatum: string;
  version?: number;
  precision?: number;
}
type Reference = World["reference"];
/** The shortest continuous chart containing a canonical geographic footprint. */
export declare function compactGeometryBounds(reference: Reference, footprint: Geometry): Bounds;
export declare function canonicalPosition(
  reference: Reference,
  p: Position,
  extent?: Bounds
): Position;
export declare function translateGeometry(geometry: Geometry, dx: number): Geometry;
/** Place canonical query or coverage pieces in a continuous working chart. */
export declare function chartFootprint(
  footprint: Geometry,
  bounds: Bounds,
  width?: number
): Geometry;
/** Copies that intersect the authoritative chart; coordinates remain continuous before clipping. */
export declare function chartCopies(reference: Reference, geometry: Geometry): Geometry[];
/** Split geography at the chart seam, keeping all pieces under one feature identity. */
export declare function canonicalGeometry(reference: Reference, geometry: Geometry): Geometry;
export declare function unwrapCoordinates(
  coordinates: Coordinate[],
  width: number | undefined
): Coordinate[];
export {};
