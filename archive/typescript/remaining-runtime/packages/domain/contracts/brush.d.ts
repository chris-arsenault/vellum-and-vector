import type { Position } from "./model";
import { type Grid, type GridSurface } from "./grids";
export interface BrushInput {
  center: Position;
  stroke?: Position[];
  channel: string;
  radius: number;
  amount: number;
  mode: "add" | "set" | "smooth";
  falloff: "linear" | "smooth" | "constant";
}
export declare function applyFieldBrush(
  data: BrushInput,
  source: GridSurface<string>,
  grid: Grid<string>
): void;
export declare function strokeDistance(point: Position, path: Position[]): number;
