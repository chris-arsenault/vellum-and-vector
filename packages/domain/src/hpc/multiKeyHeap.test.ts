import { expect, it } from "vitest";
import { MultiKeyHeap } from "./multiKeyHeap";

it("orders by each key in its direction, then by ascending item", () => {
  const heap = new MultiKeyHeap(["asc", "desc", "asc"], 4);
  const entries: [number, number, number, number][] = [
    [0, 5, 1, 0],
    [1, 2, 9, 0],
    [2, 2, 9, 3],
    [3, 2, 1, 0],
    [4, 5, 1, -1],
    [5, 2, 9, 0],
  ];
  for (const [item, a, b, c] of entries) heap.push(item, a, b, c);
  const reference = [...entries]
    .sort((x, y) => x[1] - y[1] || y[2] - x[2] || x[3] - y[3] || x[0] - y[0])
    .map((e) => e[0]);
  const popped: number[] = [];
  while (heap.size) {
    popped.push(heap.pop());
    const entry = entries[popped.at(-1)!];
    expect([heap.key(0), heap.key(1), heap.key(2)]).toEqual([entry[1], entry[2], entry[3]]);
  }
  expect(popped).toEqual(reference);
  expect(heap.pop()).toBe(-1);
  expect(() => new MultiKeyHeap([])).toThrow();
});

it("matches a comparator heap on a random single-key workload", () => {
  const heap = new MultiKeyHeap(["asc"], 8),
    reference: { item: number; key: number }[] = [];
  let state = 42;
  for (let i = 0; i < 5000; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const key = Math.floor(state / 1e6);
    heap.push(i, key);
    reference.push({ item: i, key });
    if (i % 3 === 0) {
      reference.sort((a, b) => a.key - b.key || a.item - b.item);
      expect(heap.pop()).toBe(reference.shift()!.item);
    }
  }
});
