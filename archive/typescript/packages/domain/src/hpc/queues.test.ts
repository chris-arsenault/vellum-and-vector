import { expect, it } from "vitest";
import { CellQueue } from "./cellQueue";
import { RecordQueue } from "./recordQueue";
import { Worklist } from "./worklist";

it("CellQueue keeps FIFO order across ring wrap and growth", () => {
  const queue = new CellQueue(16),
    reference: number[] = [];
  let next = 0;
  for (let round = 0; round < 2000; round++) {
    const pushes = round % 7,
      shifts = round % 5;
    for (let i = 0; i < pushes; i++) {
      queue.push(next);
      reference.push(next++);
    }
    for (let i = 0; i < shifts; i++) expect(queue.shift()).toBe(reference.shift() ?? -1);
    expect(queue.size).toBe(reference.length);
  }
  while (reference.length) expect(queue.shift()).toBe(reference.shift());
  expect(queue.shift()).toBe(-1);
});

it("RecordQueue returns cells with their fields through growth", () => {
  const queue = new RecordQueue(3, 16);
  for (let i = 0; i < 5000; i++) queue.push(i, i * 0.5, -i, i % 3);
  for (let i = 0; i < 5000; i++) {
    expect(queue.shift()).toBe(i);
    expect(queue.field(0)).toBe(i * 0.5);
    expect(queue.field(1)).toBe(-i);
    expect(queue.field(2)).toBe(i % 3);
  }
  expect(queue.shift()).toBe(-1);
  expect(() => new RecordQueue(5)).toThrow();
});

it("Worklist holds an index once until it is taken", () => {
  const list = new Worklist(100, 4);
  expect(list.add(7)).toBe(true);
  expect(list.add(7)).toBe(false);
  list.fill(10);
  expect(list.size).toBe(10);
  expect(list.take()).toBe(7);
  expect(list.add(7)).toBe(true);
  const seen: number[] = [];
  for (let i = list.take(); i >= 0; i = list.take()) seen.push(i);
  expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 8, 9, 7]);
});
