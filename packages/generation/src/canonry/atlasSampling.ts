import type { NumericValues } from "@atlas/domain";

/** Native sites are the published field support; no regular-grid projection exists. */
export function projectedValues(values: ArrayLike<number>): NumericValues {
  return values instanceof Float64Array ||
    values instanceof Float32Array ||
    values instanceof Int32Array ||
    values instanceof Uint8Array
    ? values
    : Float64Array.from(values);
}
