import type { Bounds } from "./spatial";
import type { WorkspaceScope } from "./workspace";
import { requireThat } from "./errors";
import type { SpatialScope } from "./schemas";
import type { Grid } from "./grids";

export type SampleType = "float64" | "float32" | "int32" | "uint32" | "uint8" | "int8";
export type SampleArray =
  Float64Array | Float32Array | Int32Array | Uint32Array | Uint8Array | Int8Array;
export interface ResourceArray {
  name: string;
  dtype: SampleType;
  shape: number[];
  chunkShape: number[];
  unit: string;
  quantity: "intensive" | "extensive" | "category" | "topology";
  /** Immutable masks and topology can be shared by several field resources. */
  source?: { resourceId: string; array: string };
}
export interface PartitionReference {
  id: string;
  bounds: Bounds;
  /** Cell identities and links remain meaningful outside the loaded partition. */
  cellStart: number;
  cellCount: number;
  neighbors: string[];
  arraySlices?: Record<string, { offset: number[]; shape: number[] }>;
}
export interface ChannelSummary {
  range: [number, number];
  categories: number[];
}
export interface NumericalResource {
  schemaVersion: 1;
  id: string;
  revision: number;
  scope: WorkspaceScope;
  crsId: string;
  bounds: Bounds;
  precision: number;
  layout: "regular" | "adaptive" | "mesh";
  sampling?: { width: number; height: number };
  periodicWidth?: number;
  field?: {
    id: string;
    scope: SpatialScope;
    layoutResourceId: string;
    treeResourceId?: string;
    geographyId: string;
    channels: Record<string, string>;
    summaries?: Record<string, ChannelSummary>;
    /** Exact sample summaries let scoped legends skip fully covered partitions. */
    partitionSummaries?: Record<string, Record<string, ChannelSummary>>;
  };
  state: "working" | "ready";
  arrays: ResourceArray[];
  partitions: PartitionReference[];
}
/** Coastlines and water bodies belong to indexed geography, separate from numerical chunks. */
export interface FieldGeography {
  id: string;
  scope: WorkspaceScope;
  ocean?: Grid["ocean"];
  waterBodies?: Grid["waterBodies"];
}
export interface ResourcePartition {
  reference: PartitionReference;
  arrays: Record<string, SampleArray>;
}
export interface ResourceWindow {
  resourceId: string;
  arrays: string[];
  extent: Bounds;
  halo: number;
}
export function validateResourceArray(array: ResourceArray) {
  requireThat(/^[a-zA-Z0-9_:-]+$/.test(array.name), "resource_array", "Array needs a safe name.");
  requireThat(
    array.shape.length > 0 && array.shape.length === array.chunkShape.length,
    "resource_shape",
    "Array and chunk dimensions must agree."
  );
  requireThat(
    array.shape.every((n) => Number.isSafeInteger(n) && n >= 0) &&
      array.chunkShape.every((n) => Number.isSafeInteger(n) && n > 0),
    "resource_shape",
    "Array sizes must be nonnegative and chunk sizes positive safe integers."
  );
}
export function resourceChunkKey(array: ResourceArray, coordinates: number[]) {
  validateResourceArray(array);
  requireThat(
    coordinates.length === array.shape.length &&
      coordinates.every(
        (n, i) => Number.isSafeInteger(n) && n >= 0 && n * array.chunkShape[i] < array.shape[i]
      ),
    "resource_chunk",
    "Chunk coordinates must address the declared array."
  );
  return `${array.name}/c/${coordinates.join("/")}`;
}
export function partitionsInWindow(resource: NumericalResource, window: ResourceWindow) {
  requireThat(resource.id === window.resourceId, "resource_scope", "Window needs its resource.");
  requireThat(
    Number.isFinite(window.halo) && window.halo >= 0,
    "resource_halo",
    "Halo is a distance in metres."
  );
  requireThat(
    window.arrays.every((name) => resource.arrays.some((array) => array.name === name)),
    "resource_array",
    "Window arrays must exist in the resource."
  );
  const [west, south, east, north] = window.extent;
  requireThat(
    window.extent.every(Number.isFinite) && west <= east && south <= north,
    "resource_extent",
    "Window extent must be finite and ordered."
  );
  const overlaps = (x0: number, x1: number) => {
    const low = west - window.halo,
      high = east + window.halo;
    if (!resource.periodicWidth) return x0 <= high && x1 >= low;
    const width = resource.periodicWidth;
    return Math.ceil((low - x1) / width) <= Math.floor((high - x0) / width);
  };
  return resource.partitions.filter(
    ({ bounds: [x0, y0, x1, y1] }) =>
      overlaps(x0, x1) && y0 <= north + window.halo && y1 >= south - window.halo
  );
}
