import type { NumericalAllocation, SampleArray, SampleType } from "@atlas/domain";

export const sampleConstructors = {
  float64: Float64Array,
  float32: Float32Array,
  int32: Int32Array,
  uint32: Uint32Array,
  uint8: Uint8Array,
  int8: Int8Array,
};
export interface VectorStorage {
  readonly immutable?: boolean;
  readonly type: SampleType;
  readonly length: number;
  read(index: number): number;
  write(index: number, value: number): void;
  readBlock(start: number, count: number): SampleArray;
  writeBlock(start: number, values: ArrayLike<number>): void;
  fill(start: number, count: number, value: number): void;
  allocate(input: NumericalAllocation): VectorStorage;
  retain(): void;
  release(): void;
}
export function vectorRange(length: number, start = 0, end = length) {
  const index = (n: number) =>
    Number.isNaN(n)
      ? 0
      : n < 0
        ? Math.max(0, length + Math.trunc(n))
        : Math.min(length, Math.trunc(n));
  const first = index(start),
    last = index(end);
  return { start: first, end: Math.max(first, last), length: Math.max(0, last - first) };
}
