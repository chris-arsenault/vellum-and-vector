import { requireThat } from "../errors";

/** A float64 key as two unsigned 32-bit halves whose lexicographic order is numeric order.
 * Negative keys flip every bit, non-negative keys flip the sign bit. */
const scratch = new Float64Array(1),
  halves = new Uint32Array(scratch.buffer);
scratch[0] = 1;
requireThat(
  halves[1] === 0x3ff00000,
  "key_endianness",
  "Ordered keys require little-endian typed arrays."
);
/** -0 orders as 0, so key order agrees with numeric comparison. */
export function orderedHi(key: number): number {
  requireThat(key === key, "key_nan", "Keys must not be NaN.");
  scratch[0] = key === 0 ? 0 : key;
  const hi = halves[1];
  return hi & 0x80000000 ? ~hi >>> 0 : (hi ^ 0x80000000) >>> 0;
}
/** Call after orderedHi for the same key; shares the scratch write. */
export function orderedLo(): number {
  return halves[1] & 0x80000000 ? ~halves[0] >>> 0 : halves[0];
}
export function keyFromOrdered(hi: number, lo: number): number {
  if (hi & 0x80000000) {
    halves[1] = (hi ^ 0x80000000) >>> 0;
    halves[0] = lo;
  } else {
    halves[1] = ~hi >>> 0;
    halves[0] = ~lo >>> 0;
  }
  return scratch[0];
}
/** Unsigned lexicographic comparison of two ordered keys. */
export function orderedLess(hiA: number, loA: number, hiB: number, loB: number) {
  return hiA !== hiB ? hiA < hiB : loA < loB;
}
