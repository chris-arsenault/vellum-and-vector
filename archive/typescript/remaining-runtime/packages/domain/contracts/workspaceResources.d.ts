import type { Bounds } from "./spatial";
import type { WorkspaceScope } from "./workspace";
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
  source?: {
    resourceId: string;
    array: string;
  };
}
export interface PartitionReference {
  id: string;
  bounds: Bounds;
  /** Cell identities and links remain meaningful outside the loaded partition. */
  cellStart: number;
  cellCount: number;
  neighbors: string[];
  /** Only named arrays occupy this partition; omitted arrays have no samples. */
  arraySlices?: Record<
    string,
    {
      offset: number[];
      shape: number[];
    }
  >;
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
  sampling?: {
    width: number;
    height: number;
  };
  periodicWidth?: number;
  field?: {
    id: string;
    scope: SpatialScope;
    layoutResourceId: string;
    treeResourceId?: string;
    geographyId: string;
    channels: Record<string, string>;
    materialCargo?: {
      keys: readonly string[];
      releasedTo: readonly string[];
      slots: readonly string[];
      offsets: string;
      records: string;
    };
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
  lakes?: Grid["lakes"];
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
export declare function validateResourceArray(array: ResourceArray): void;
export declare function resourceChunkKey(array: ResourceArray, coordinates: number[]): string;
export declare function partitionsInWindow(
  resource: NumericalResource,
  window: ResourceWindow
): PartitionReference[];
