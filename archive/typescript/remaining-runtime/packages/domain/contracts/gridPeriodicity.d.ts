import type { Geometry } from "geojson";
import { type Grid } from "./grids";
import type { Position } from "./model";
/** Coverage in the same continuous chart as a field's samples. Catalog scope stays canonical. */
export declare function fieldChartFootprint(grid: Grid<string>): Geometry;
/** Locate a canonical coordinate in a compact field's continuous seam chart. */
export declare function fieldPosition(grid: Grid<string>, p: Position): Position;
export declare function gridDistance(
  grid: Grid<string>,
  a: Pick<Position, "x" | "y">,
  b: Pick<Position, "x" | "y">
): number;
export declare function gridDisplacement(
  grid: Grid<string>,
  a: Pick<Position, "x" | "y">,
  b: Pick<Position, "x" | "y">
): {
  x: number;
  y: number;
};
/** Extra neighbors use two short chart segments, preserving holes and irregular coastlines. */
export declare function seamNeighbors(
  grid: Grid<string>,
  index: number,
  covers: (geometry: Geometry) => boolean
): number[];
