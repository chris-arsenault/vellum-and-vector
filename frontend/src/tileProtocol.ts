import type { GridSurface } from "@atlas/domain";
import type { Raster } from "./types";

export type TileRaster = Omit<Raster, "field" | "water" | "ice"> & {
  field: number;
  water?: number;
  ice?: number;
};
export type TileMessage =
  | { kind: "grid"; id: number; grid: GridSurface }
  | { kind: "raster"; id: number; raster: TileRaster }
  | { kind: "tile"; id: number; request: number; extent: number[]; size: number }
  | { kind: "release"; id: number; grids: number[] }
  | { kind: "cancel"; request: number };
export type TileReply =
  { request: number; values: Float32Array } | { request: number; error: string };
