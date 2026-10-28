import { expect, it } from "vitest";
import { MonotoneHeap } from "./monotoneHeap";

function lcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
/** A flood-shaped workload: pops drive pushes of keys at or beyond the popped key. */
function flood(heap: MonotoneHeap, order: "min" | "max", seed: number) {
  const random = lcg(seed),
    popped: number[] = [];
  let pending = 0;
  for (let i = 0; i < 200; i++) {
    const key = (random() - 0.5) * 1e6;
    heap.push(i, key);
    pending++;
  }
  let item = 200;
  while (heap.size) {
    heap.pop();
    const key = heap.key();
    popped.push(key);
    pending--;
    if (pending < 100_000 && random() < 0.6) {
      const step = random() * 1000 * (order === "min" ? 1 : -1);
      heap.push(item++, key + step);
      pending++;
      if (random() < 0.2) {
        heap.push(item++, key);
        pending++;
      }
    }
  }
  return popped;
}

it("pops keys in nondecreasing order with equal keys served in arrival order", () => {
  const popped = flood(new MonotoneHeap("min"), "min", 7);
  expect(popped.length).toBeGreaterThan(200);
  for (let i = 1; i < popped.length; i++) expect(popped[i]).toBeGreaterThanOrEqual(popped[i - 1]);
});

it("serves a max-ordered frontier in nonincreasing order", () => {
  const popped = flood(new MonotoneHeap("max"), "max", 11);
  for (let i = 1; i < popped.length; i++) expect(popped[i]).toBeLessThanOrEqual(popped[i - 1]);
});

it("returns every item exactly once with its key, across negative, zero and huge keys", () => {
  const heap = new MonotoneHeap("min"),
    keys = [-1e300, -5, -0, 0, 1e-300, 3, 3, 1e18, Infinity];
  keys.forEach((key, i) => heap.push(i, key));
  const items: number[] = [];
  while (heap.size) {
    items.push(heap.pop());
    // -0 reads back as 0: keys are ordered numerically, not by sign bit.
    expect(heap.key()).toBe(keys[items.at(-1)!] + 0);
  }
  expect([...items].sort((a, b) => a - b)).toEqual(keys.map((_, i) => i));
  expect(items.map((i) => keys[i])).toEqual([...keys].sort((a, b) => a - b));
});

it("rejects a key before the last popped key and NaN keys", () => {
  const heap = new MonotoneHeap("min");
  heap.push(0, 10);
  heap.push(1, 20);
  heap.pop();
  expect(() => heap.push(2, 5)).toThrow(/monotone/);
  heap.push(3, 10);
  expect(() => heap.push(4, NaN)).toThrow();
  expect(heap.pop()).toBe(3);
  expect(heap.pop()).toBe(1);
  expect(heap.pop()).toBe(-1);
});
