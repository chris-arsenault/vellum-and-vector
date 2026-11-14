import type { FieldSamples } from "./grids";
import type { Geometry } from "geojson";
import type { SpatialScope } from "./schemas";
import { type AdaptiveTopology } from "./adaptiveTopology";
import type { BlockCache } from "./lattice/blockCache";
import type { Coverage } from "./lattice/coverage";
/** Generated fields retain adaptive physical samples instead of a mandatory uniform raster. */
export interface AdaptiveField<
  Name extends string = import("./fieldChannels").FieldChannelName,
> extends FieldSamples<Name> {
  width?: never;
  height?: never;
  topology: AdaptiveTopology;
}
/** Area of each leaf inside the footprint, as a band in `coverage`. */
export declare function adaptiveMeasures(
  topology: AdaptiveTopology,
  footprint: Geometry,
  coverage?: Coverage
): import("./lattice").Band;
export declare function createAdaptiveField<
  Name extends string = import("./fieldChannels").FieldChannelName,
>(
  id: string,
  scope: SpatialScope,
  topology: AdaptiveTopology,
  cache?: BlockCache,
  periodicWidth?: number
): AdaptiveField<Name>;
export declare function adaptiveFieldSampler<Name extends string>(
  field: AdaptiveField<Name>,
  channel: NoInfer<Name>,
  discrete?: boolean
): (p: { x: number; y: number }) => number;
export declare function adaptiveIntegral<Name extends string>(
  field: AdaptiveField<Name>,
  channel: NoInfer<Name>
): number;
