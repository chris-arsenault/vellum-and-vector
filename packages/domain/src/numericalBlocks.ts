import { requireThat } from "./errors";
import type { NumericalVector } from "./numericalVector";
import type { SampleArray } from "./workspaceResources";

/** Input blocks may borrow native storage. Algorithms publish into separate output blocks. */
export function readNumericalBlock(
  vector: NumericalVector,
  start: number,
  count: number
): SampleArray {
  requireThat(
    Number.isSafeInteger(start) &&
      Number.isSafeInteger(count) &&
      start >= 0 &&
      count >= 0 &&
      start + count <= vector.length,
    "numerical_range",
    "Read stays inside its numerical vector."
  );
  if (vector.readBlock) return vector.readBlock(start, count);
  requireThat(
    ArrayBuffer.isView(vector) && !(vector instanceof DataView),
    "numerical_storage",
    "A numerical vector needs native samples or block access."
  );
  return (vector as SampleArray).subarray(start, start + count);
}
export function writeNumericalBlock(vector: NumericalVector, start: number, values: SampleArray) {
  requireThat(
    Number.isSafeInteger(start) && start >= 0 && start + values.length <= vector.length,
    "numerical_range",
    "Write stays inside its numerical vector."
  );
  if (vector.writeBlock) vector.writeBlock(start, values);
  else vector.set(values, start);
}
