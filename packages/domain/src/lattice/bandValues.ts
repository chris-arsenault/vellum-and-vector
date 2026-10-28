import type { SampleType } from "../workspaceResources";
import { Band, type BandSchema } from "./band";
import { BlockCache } from "./blockCache";
import { newBlock, type BlockArray } from "./blockScratch";
import { Coverage, sampleLayout } from "./coverage";
import { blockMask, blockShift } from "./lattice";
import { requireThat } from "../errors";

/** A coverage of `count` samples with no geometry of its own: a grid's or a topology's. */
export function sampleCoverage(count: number, cache: BlockCache = new BlockCache(Infinity)) {
  return new Coverage(sampleLayout(count), cache);
}
/** Write every sample of a band from a function of its index, one block at a time. */
export function fillBand(band: Band, value: (i: number) => number) {
  for (let b = 0; b < band.blockCount; b++) {
    const values = band.block(b, true),
      start = b << blockShift;
    for (let n = 0; n < values.length; n++) values[n] = value(start + n);
    band.unpin(b);
  }
  return band;
}
/** A run-lifetime band in the coverage, filled from a function of the sample index. */
export function generateBand(
  coverage: Coverage,
  type: SampleType,
  name: string,
  value: (i: number) => number,
  length = coverage.lattice.count
) {
  const band = coverage.scratch(type, name, length);
  band.retain();
  return fillBand(band, value);
}
/** A run-lifetime band in the coverage holding a copy of small resident values. */
export function bandFrom(
  coverage: Coverage,
  type: SampleType,
  name: string,
  values: ArrayLike<number>
) {
  return generateBand(coverage, type, name, (i) => values[i], values.length);
}
/** A standalone resident band over a copy of the values, for literals and tests. */
export function residentBand(
  type: SampleType,
  values: ArrayLike<number>,
  schema: Partial<BandSchema> = {}
) {
  const copy = newBlock(type, values.length);
  copy.set(values);
  return Band.over(
    copy,
    { name: "values", type, lifetime: "run", ...schema },
    new BlockCache(Infinity)
  );
}
/** Copy a run of samples out of a band into `into` at `at`, one block at a time. */
export function readRange(
  band: Band,
  start: number,
  count: number,
  into: BlockArray = newBlock(band.type, count),
  at = 0
) {
  requireThat(
    start >= 0 && count >= 0 && start + count <= band.length,
    "numerical_range",
    "Read stays inside its band."
  );
  for (let i = 0; i < count;) {
    const b = (start + i) >>> blockShift,
      offset = (start + i) & blockMask,
      block = band.block(b),
      size = Math.min(count - i, block.length - offset);
    into.set(block.subarray(offset, offset + size), at + i);
    band.unpin(b);
    i += size;
  }
  return into;
}
/** Write a run of samples into a band from `start`, one block at a time. */
export function writeRange(band: Band, start: number, values: ArrayLike<number>) {
  requireThat(
    start >= 0 && start + values.length <= band.length,
    "numerical_range",
    "Write stays inside its band."
  );
  for (let i = 0; i < values.length;) {
    const b = (start + i) >>> blockShift,
      offset = (start + i) & blockMask,
      block = band.block(b, true),
      size = Math.min(values.length - i, block.length - offset);
    for (let n = 0; n < size; n++) block[offset + n] = values[i + n];
    band.unpin(b);
    i += size;
  }
}
/** Whether every sample satisfies the predicate, stopping at the first that fails. */
export function everySample(band: Band, test: (value: number, i: number) => boolean) {
  for (let i = 0; i < band.length; i++) if (!test(band.get(i), i)) return false;
  return true;
}
/** Whether any sample satisfies the predicate, stopping at the first that does. */
export function someSample(band: Band, test: (value: number, i: number) => boolean) {
  for (let i = 0; i < band.length; i++) if (test(band.get(i), i)) return true;
  return false;
}
/** Fold every sample in index order. */
export function foldSamples<T>(band: Band, fold: (sum: T, value: number, i: number) => T, seed: T) {
  let result = seed;
  for (let i = 0; i < band.length; i++) result = fold(result, band.get(i), i);
  return result;
}
