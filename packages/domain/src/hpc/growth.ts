/** Typed-array growth by doubling. Callers keep the returned array; the old one is dropped. */
export type TypedArray = Int32Array | Uint32Array | Float64Array | Uint8Array;
export function grown<T extends TypedArray>(values: T, minimum: number): T {
  if (values.length >= minimum) return values;
  const Constructor = values.constructor as new (length: number) => T;
  const next = new Constructor(Math.max(minimum, values.length * 2, 16));
  next.set(values);
  return next;
}
