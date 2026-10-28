import { expect, it } from "vitest";
import { radixOrder } from "./radixOrder";

function reference(keys: ArrayLike<number>, descending: boolean) {
  return Int32Array.from({ length: keys.length }, (_, i) => i).sort(
    (a, b) => (descending ? keys[b] - keys[a] : keys[a] - keys[b]) || a - b
  );
}
function sample(seed: number, n: number) {
  let state = seed >>> 0;
  const keys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const r = state / 4294967296;
    keys[i] = r < 0.1 ? Math.floor(r * 50) : r < 0.2 ? -(r * 1e9) : (r - 0.5) * 2 ** (r * 40);
  }
  keys[0] = -0;
  keys[1] = 0;
  keys[2] = Infinity;
  keys[3] = -Infinity;
  return keys;
}

it("orders float keys ascending and descending with ties by ascending index", () => {
  const keys = sample(3, 20_000);
  expect(Array.from(radixOrder(keys))).toEqual(Array.from(reference(keys, false)));
  expect(Array.from(radixOrder(keys, true))).toEqual(Array.from(reference(keys, true)));
});

it("handles integer columns, constant columns and empty input", () => {
  const ints = Int32Array.from([5, -3, 5, 0, -3, 2147483647, -2147483648]);
  expect(Array.from(radixOrder(ints))).toEqual(Array.from(reference(ints, false)));
  expect(Array.from(radixOrder(ints, true))).toEqual(Array.from(reference(ints, true)));
  const same = new Float64Array(100).fill(42);
  expect(Array.from(radixOrder(same))).toEqual(Array.from(same.keys()));
  expect(Array.from(radixOrder(same, true))).toEqual(Array.from(same.keys()));
  expect(radixOrder(new Float64Array(0)).length).toBe(0);
});
