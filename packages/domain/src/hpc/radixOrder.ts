import { orderedHi, orderedLo } from "./keyBits";

const counts = new Int32Array(256);
/** One LSD pass on byte `shift` of `digits`; returns false (and leaves order untouched) when
 * every key shares the byte. */
function pass(digits: Uint32Array, shift: number, source: Int32Array, target: Int32Array): boolean {
  counts.fill(0);
  const n = source.length;
  for (let i = 0; i < n; i++) counts[(digits[source[i]] >>> shift) & 0xff]++;
  for (let b = 0; b < 256; b++) if (counts[b] === n) return false;
  let offset = 0;
  for (let b = 0; b < 256; b++) {
    const c = counts[b];
    counts[b] = offset;
    offset += c;
  }
  for (let i = 0; i < n; i++) {
    const index = source[i];
    target[counts[(digits[index] >>> shift) & 0xff]++] = index;
  }
  return true;
}
/** Indices of `keys` in ascending key order, ties by ascending index; `descending` reverses
 * the key order and keeps ties ascending. Eight stable byte passes over the ordered bits of
 * each float64 key; passes whose byte is constant are skipped. */
export function radixOrder(keys: ArrayLike<number>, descending = false): Int32Array {
  const n = keys.length,
    hi = new Uint32Array(n),
    lo = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    hi[i] = orderedHi(keys[i]);
    lo[i] = orderedLo();
  }
  // Descending output is the ascending order reversed; starting from descending indices keeps
  // equal keys in ascending index order after the reversal.
  let source = new Int32Array(n),
    target = new Int32Array(n);
  for (let i = 0; i < n; i++) source[i] = descending ? n - 1 - i : i;
  for (let shift = 0; shift < 32; shift += 8)
    if (pass(lo, shift, source, target)) [source, target] = [target, source];
  for (let shift = 0; shift < 32; shift += 8)
    if (pass(hi, shift, source, target)) [source, target] = [target, source];
  if (descending) source.reverse();
  return source;
}
