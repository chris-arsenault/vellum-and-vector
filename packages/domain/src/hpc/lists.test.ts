import { expect, it } from "vitest";
import { CellList, FloatList } from "./typedList";
import { KeyedHeap, TopK } from "./keyedHeap";
import { EdgeTable, edgeLeadingTo } from "./edgeTable";

it("lists grow, finish as views and sort natively", () => {
  const cells = new CellList(4);
  for (let i = 100; i > 0; i--) cells.push(i);
  expect(cells.length).toBe(100);
  expect(cells.at(0)).toBe(100);
  cells.sort();
  expect(Array.from(cells.finish().subarray(0, 3))).toEqual([1, 2, 3]);
  const floats = new FloatList(2);
  floats.push(0.5);
  floats.push(-1);
  floats.set(0, 2);
  expect(Array.from(floats.finish())).toEqual([2, -1]);
  floats.clear();
  expect(floats.length).toBe(0);
});

it("KeyedHeap pops in key order with index tie rules", () => {
  const heap = new KeyedHeap("min", "lower-first", 4);
  const entries = [5, 1, 3, 1, 9, 0, 3].map((key, item) => [item, key] as const);
  for (const [item, key] of entries) heap.push(item, key);
  const order: number[] = [];
  while (heap.size) order.push(heap.pop());
  expect(order).toEqual([5, 1, 3, 2, 6, 0, 4]);
  const max = new KeyedHeap("max", "higher-first", 4);
  for (const [item, key] of entries) max.push(item, key);
  expect(max.peekItem()).toBe(4);
  expect(max.peekKey()).toBe(9);
  max.pop();
  expect(max.poppedKey()).toBe(9);
  expect(max.pop()).toBe(0);
  expect(max.pop()).toBe(6);
  expect(max.pop()).toBe(2);
});

it("TopK keeps the k strongest by score then lowest index", () => {
  const scores = [0.2, 0.9, 0.5, 0.9, 0.1, 0.5, 0.7];
  const reference = scores
    .map((score, index) => ({ score, index }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 4)
    .map((entry) => entry.index);
  const selection = new TopK(4);
  scores.forEach((score, index) => selection.consider(index, score));
  expect(Array.from(selection.best())).toEqual(reference);
});

it("EdgeTable lists each face once with symmetric slots", () => {
  // A 2x2 grid: 0-1, 2-3 horizontal; 0-2, 1-3 vertical; stride 4.
  const neighbors = Int32Array.from([1, 2, -1, -1, 0, 3, -1, -1, 0, 3, -1, -1, 1, 2, -1, -1]);
  const adjacency = { count: 4, stride: 4, degree: [2, 2, 2, 2], neighbors };
  const table = new EdgeTable(adjacency);
  expect(table.count).toBe(4);
  for (let f = 0; f < table.count; f++) {
    const i = table.from[f],
      j = table.to[f];
    expect(i).toBeLessThan(j);
    expect(table.slot[i * 4 + edgeLeadingTo(adjacency, i, j)]).toBe(f);
    expect(table.slot[j * 4 + edgeLeadingTo(adjacency, j, i)]).toBe(f);
    expect(table.other(f, i)).toBe(j);
  }
  const weight = table.column("weight");
  weight[0] = 1.5;
  expect(table.column("weight")[0]).toBe(1.5);
  expect(() => edgeLeadingTo(adjacency, 0, 3)).toThrow();
});
