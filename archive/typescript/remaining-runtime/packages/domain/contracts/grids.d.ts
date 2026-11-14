import type { Geometry } from "geojson";
import type { Position } from "./model";
import type { SpatialScope } from "./schemas";
import { type Bounds } from "./spatial";
import type { AdaptiveField } from "./adaptiveField";
import { type AdaptivePointLocator } from "./adaptivePoint";
import type { Band } from "./lattice/band";
import type { BlockCache } from "./lattice/blockCache";
import type { Coverage } from "./lattice/coverage";
import type { MaterialCargoSamples } from "./materialSamples";
import type { FieldChannelName } from "./fieldChannels";
export {
  channelBand,
  generateChannel,
  putChannel,
  requireChannel,
  channelUnit,
} from "./fieldSamples";
/**
 * Samples of a located field. The samples are the cells of the grid's coverage; every value
 * the grid holds (its active mask, its measures and its channels) is a band in that coverage,
 * paged through the coverage's block cache.
 */
export interface FieldSamples<Name extends string = FieldChannelName> {
  periodicWidth?: number;
  id: string;
  scope: SpatialScope;
  bounds: Bounds;
  coverage: Coverage;
  active: Band;
  measures: Band;
  channels: Partial<Record<Name, Band>>;
  units: Partial<Record<Name, string>>;
  waterBodies?: WaterBody[] | null;
  /** Physical lake shores survive omission from the named geographic catalog. */
  lakes?: {
    id: string;
    geometry: Geometry;
    level: number;
  }[];
  /** Physical ocean extent; resampling elevation must not move its shoreline. */
  ocean?: Geometry | null;
  quantities?: Partial<Record<Name, "intensive" | "extensive" | "category">>;
  /** Sparse charge belongs to the complete material donor, never an interpolated channel. */
  materialCargo?: MaterialCargoSamples;
}
export interface RegularGrid<Name extends string = FieldChannelName> extends FieldSamples<Name> {
  width: number;
  height: number;
  topology?: never;
}
export type Grid<Name extends string = FieldChannelName> = RegularGrid<Name> | AdaptiveField<Name>;
export type GridSurface<Name extends string = FieldChannelName> = Grid<Name> & {
  overlays?: {
    grid: GridSurface<Name>;
    channels: Name[];
    mapOnly?: boolean;
  }[];
};
export interface WaterBody {
  id: string;
  footprint: Geometry;
  slices: {
    floor: number;
    area: number;
    footprint: Geometry | null;
    sediment: number;
  }[];
  volume: number;
  spill: number;
  outlet: Position | null;
  outletFrom: Position | null;
  suspended: number;
  fixedLevel: number | null;
  outletPath: Position[] | null;
}
/** Samples in the grid. */
export declare function gridSamples(grid: FieldSamples<string>): number;
export declare function gridPosition(grid: Grid<string>, index: number): Position;
export declare function gridCellBounds(grid: Grid<string>, index: number): Bounds;
/**
 * A regular raster over the sample bounds. Its bands page through `cache`; without one the
 * grid is resident.
 */
export declare function createGrid<Name extends string = FieldChannelName>(
  id: string,
  scope: SpatialScope,
  width: number,
  height: number,
  sampleBounds?: Bounds,
  cache?: BlockCache,
  periodicWidth?: number
): RegularGrid<Name>;
export declare function neighbors(
  grid: Grid<string>,
  index: number,
  diagonal?: boolean,
  covers?: (geometry: Geometry) => boolean
): number[];
export declare function sample<Name extends string>(
  grid: GridSurface<Name>,
  channel: NoInfer<Name>,
  p: Position,
  discrete?: boolean
): number;
export declare function gridSampler<Name extends string>(
  grid: GridSurface<Name>,
  channel: NoInfer<Name>,
  discrete?: boolean
): (position: Position) => number;
/**
 * Prepared base polynomial, including numerical-halo extension; public reads use gridSampler.
 * A viewport reader keeps the default patch caches; a sweep over the grid passes a budget
 * with room for every cell (`sweepBudget`).
 */
export declare function fieldInterpolator<Name extends string>(
  grid: GridSurface<Name>,
  channel: NoInfer<Name>,
  discrete?: boolean,
  locate?: AdaptivePointLocator,
  budget?: number
): (p: Position) => number;
/** The value every sample holds, or NaN when they differ or any is not finite. */
export declare function uniformValue(values: Band): number;
export declare function interpolateSample<Name extends string>(
  grid: Grid<Name>,
  channel: NoInfer<Name>,
  p: Position,
  discrete?: boolean
): number;
export declare function fieldCoverage(grid: Grid<string>): Geometry;
