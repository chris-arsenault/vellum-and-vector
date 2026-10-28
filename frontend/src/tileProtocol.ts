import type { GridArrays } from "@atlas/domain";
import type { LoadedRaster, ResourceRaster } from "./types";

export type TileRaster = Omit<LoadedRaster, "field" | "water" | "ice" | "surface"> & {
  field: number;
  water?: number;
  ice?: number;
  surface?: number;
};
export type TileMessage =
  | { kind: "connect"; port: MessagePort }
  /** An in-memory grid crosses as plain arrays; bands never leave their worker's cache. */
  | { kind: "grid"; id: number; grid: GridArrays }
  | { kind: "raster"; id: number; raster: TileRaster }
  | { kind: "resourceRaster"; id: number; raster: ResourceRaster }
  | { kind: "tile"; id: number; request: number; extent: number[]; size: number }
  | { kind: "release"; id: number; grids: number[] }
  | { kind: "cancel"; request: number }
  | { kind: "close" };
export type TileReply =
  | { request: number; values: Float32Array }
  | { request: number; error: string }
  | { kind: "closed" };
