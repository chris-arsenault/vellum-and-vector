import type { FieldSamples, Grid } from "./grids";
import type { Band } from "./lattice/band";
import type { SampleType } from "./workspaceResources";
/** A run-lifetime channel band of the grid's sample count, initially zero. */
export declare function channelBand(
  grid: FieldSamples<string>,
  name: string,
  type?: SampleType
): Band;
/** A run-lifetime channel band of the grid filled from a function of the sample index. */
export declare function generateChannel(
  grid: FieldSamples<string>,
  name: string,
  value: (i: number) => number,
  type?: SampleType
): Band;
export declare function putChannel<Name extends string>(
  grid: Grid<Name>,
  name: NoInfer<Name>,
  unit: string,
  values: Band,
  quantity?: "intensive" | "extensive" | "category"
): void;
/** Required-channel reads fail at the consumer boundary before entering a sampling loop. */
export declare function requireChannel<Name extends string>(
  grid: FieldSamples<Name>,
  name: NoInfer<Name>
): Band;
export declare function channelUnit<Name extends string>(
  grid: FieldSamples<Name>,
  name: NoInfer<Name>
): string;
