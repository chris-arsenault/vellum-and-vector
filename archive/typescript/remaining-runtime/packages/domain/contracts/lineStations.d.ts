import type { Geometry } from "geojson";
import type { Position } from "./model";
export declare function lineParts(geometry: Geometry): number[][][];
export interface LineLocation {
  part: number;
  segment: number;
  offset: number;
  fraction: number;
  distance: number;
  point: Position;
  tangent: Position;
}
export declare function locateOnLine(geometry: Geometry, p: Position): LineLocation;
export declare function stationAt(
  geometry: Geometry,
  attributes: Record<string, unknown>,
  channel: string,
  p: Position
): number | null;
export declare function crossingDirection(
  geometry: Geometry,
  footprint: Geometry,
  p: Position,
  precision: number
): string;
export declare function interpolateProfile(
  source: Geometry,
  attributes: Record<string, unknown>,
  target: Geometry,
  channel: string
): number[] | null;
