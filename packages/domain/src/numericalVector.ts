import type { SampleArray, SampleType } from "./workspaceResources";

/** Indexed numerical state. Its storage may span disk pages; it has no whole-field buffer. */
export interface NumericalVector extends Iterable<number> {
  [index: number]: number;
  readonly length: number;
  readonly sampleType?: SampleType;
  readonly immutable?: boolean;
  /** Promote an output that the working state carries into later processes. */
  retain?(): void;
  /** Disk views provide block IO; native typed arrays use their ordinary subarray/set methods. */
  readBlock?(start: number, count: number): SampleArray;
  writeBlock?(start: number, values: SampleArray): void;
  at(index: number): number | undefined;
  set(values: ArrayLike<number>, offset?: number): void;
  fill(value: number, start?: number, end?: number): this;
  slice(start?: number, end?: number): NumericalVector;
  subarray(start?: number, end?: number): NumericalVector;
  copyWithin(target: number, start: number, end?: number): this;
  reverse(): this;
  sort(compare?: (a: number, b: number) => number): this;
  forEach(callback: (value: number, index: number, array: NumericalVector) => void): void;
  map(callback: (value: number, index: number, array: NumericalVector) => number): NumericalVector;
  filter(
    callback: (value: number, index: number, array: NumericalVector) => unknown
  ): NumericalVector;
  every(callback: (value: number, index: number, array: NumericalVector) => unknown): boolean;
  some(callback: (value: number, index: number, array: NumericalVector) => unknown): boolean;
  find(
    callback: (value: number, index: number, array: NumericalVector) => unknown
  ): number | undefined;
  findIndex(callback: (value: number, index: number, array: NumericalVector) => unknown): number;
  indexOf(value: number, fromIndex?: number): number;
  includes(value: number, fromIndex?: number): boolean;
  reduce(
    callback: (previous: number, value: number, index: number, array: NumericalVector) => number
  ): number;
  reduce<T>(
    callback: (previous: T, value: number, index: number, array: NumericalVector) => T,
    initial: T
  ): T;
  join(separator?: string): string;
  entries(): IterableIterator<[number, number]>;
  keys(): IterableIterator<number>;
  values(): IterableIterator<number>;
}
/** Native samples and working views declare the same physical storage types. */
export function numericalSampleType(value: unknown): SampleType | undefined {
  if (value instanceof Float64Array) return "float64";
  if (value instanceof Float32Array) return "float32";
  if (value instanceof Int32Array) return "int32";
  if (value instanceof Uint32Array) return "uint32";
  if (value instanceof Uint8Array) return "uint8";
  if (value instanceof Int8Array) return "int8";
  if (!value || typeof value !== "object") return undefined;
  return workingSampleType(value);
}
function workingSampleType(value: object): SampleType | undefined {
  const view = value as NumericalVector;
  return Number.isSafeInteger(view.length) &&
    view.length >= 0 &&
    typeof view.readBlock === "function" &&
    typeof view.writeBlock === "function" &&
    typeof view.every === "function" &&
    typeof view.set === "function"
    ? view.sampleType
    : undefined;
}
export function isNumericalVector(value: unknown): value is NumericalVector {
  return numericalSampleType(value) !== undefined;
}
export interface NumericalAllocation {
  type: SampleType;
  length: number;
  lifetime: "process" | "run";
  name: string;
}
/** Execution container allocation, independent of browser APIs and either repository port. */
export interface NumericalAllocator {
  allocate(input: NumericalAllocation): NumericalVector;
  read(vector: NumericalVector, start: number, count: number): SampleArray;
  write(vector: NumericalVector, start: number, values: SampleArray): void;
  release(vector: NumericalVector): void;
  /** Release replaced owned buffers, preserving aliases still used by the current state. */
  releaseUnused(candidates: Iterable<NumericalVector>, live: Iterable<NumericalVector>): void;
  retain(vector: NumericalVector): void;
  beginProcess(): number;
  releaseProcess(from?: number): void;
}
