import type { SampleType } from "../workspaceResources";
import { Band, type BandSchema } from "./band";
import { BlockCache } from "./blockCache";
import { type BlockArray } from "./blockScratch";
import { Coverage } from "./coverage";
import type { ReadBand } from "./readBand";
/** A coverage of `count` samples with no geometry of its own: a grid's or a topology's. */
export declare function sampleCoverage(count: number, cache?: BlockCache): Coverage;
/** Write every sample of a band from a function of its index, one block at a time. */
export declare function fillBand(band: Band, value: (i: number) => number): Band;
/** A run-lifetime band in the coverage, filled from a function of the sample index. */
export declare function generateBand(
  coverage: Coverage,
  type: SampleType,
  name: string,
  value: (i: number) => number,
  length?: number
): Band;
/** A run-lifetime band in the coverage holding a copy of small resident values. */
export declare function bandFrom(
  coverage: Coverage,
  type: SampleType,
  name: string,
  values: ArrayLike<number>
): Band;
/** A standalone resident band over a copy of the values, for literals and tests. */
export declare function residentBand(
  type: SampleType,
  values: ArrayLike<number>,
  schema?: Partial<BandSchema>
): Band;
/** Copy a run of samples out of a band into `into` at `at`, one block at a time. */
export declare function readRange(
  band: ReadBand,
  start: number,
  count: number,
  into?: BlockArray,
  at?: number
): BlockArray;
/** Write a run of samples into a band from `start`, one block at a time. */
export declare function writeRange(band: Band, start: number, values: ArrayLike<number>): void;
/** Whether every sample satisfies the predicate, stopping at the first that fails. */
export declare function everySample(
  band: ReadBand,
  test: (value: number, i: number) => boolean
): boolean;
/** Whether any sample satisfies the predicate, stopping at the first that does. */
export declare function someSample(
  band: ReadBand,
  test: (value: number, i: number) => boolean
): boolean;
/** Fold every sample in index order. */
export declare function foldSamples<T>(
  band: ReadBand,
  fold: (sum: T, value: number, i: number) => T,
  seed: T
): T;
