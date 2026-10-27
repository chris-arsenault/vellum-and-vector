import type { NumericalAllocation, NumericalAllocator, NumericalVector } from "./numericalVector";
import { writeNumericalBlock } from "./numericalBlocks";

const constructors = {
  float64: Float64Array,
  float32: Float32Array,
  int32: Int32Array,
  uint32: Uint32Array,
  uint8: Uint8Array,
  int8: Int8Array,
};
/** Native execution remains useful for small pure-domain callers; workers supply their arena. */
export function allocateNumerical(
  input: NumericalAllocation,
  allocator?: NumericalAllocator
): NumericalVector {
  return allocator ? allocator.allocate(input) : new constructors[input.type](input.length);
}
/** Fill output in bounded native blocks, retaining the requested sample coercion. */
export function generateNumerical(
  input: NumericalAllocation,
  sample: (index: number) => number,
  allocator?: NumericalAllocator
): NumericalVector {
  const vector = allocateNumerical(input, allocator),
    blockSize = 32_768;
  for (let start = 0; start < input.length; start += blockSize) {
    const values = new constructors[input.type](Math.min(blockSize, input.length - start));
    for (let at = 0; at < values.length; at++) values[at] = sample(start + at);
    writeNumericalBlock(vector, start, values);
  }
  return vector;
}
