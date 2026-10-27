// Binary heap for the priority-queue operations used by Canonry's C# layers.
import type { NumericalAllocator } from "@atlas/domain";
import { NativeHeapStorage, NumericHeapStorage, type HeapStorage } from "./queueStorage";
export class PriorityQueue<T extends Record<string, number>> {
  private readonly values: HeapStorage<T>;
  constructor(
    private readonly compare: (a: T, b: T) => number,
    numerical?: NumericalAllocator,
    fields: readonly (keyof T)[] = []
  ) {
    this.values = numerical ? new NumericHeapStorage(numerical, fields) : new NativeHeapStorage();
  }
  get count() {
    return this.values.length;
  }
  close() {
    this.values.close();
  }
  peek(): T {
    return this.values.get(0);
  }
  push(value: T) {
    let index = this.values.length;
    this.values.push(value);
    while (index > 0) {
      const parent = (index - 1) >>> 1;
      if (this.compare(value, this.values.get(parent)) >= 0) break;
      this.values.set(index, this.values.get(parent));
      index = parent;
    }
    this.values.set(index, value);
  }
  pop(): T {
    const first = this.values.get(0),
      last = this.values.pop()!;
    if (!this.values.length) return first;
    let index = 0;
    while (index * 2 + 1 < this.values.length) {
      let child = index * 2 + 1;
      if (
        child + 1 < this.values.length &&
        this.compare(this.values.get(child + 1), this.values.get(child)) < 0
      )
        child++;
      if (this.compare(last, this.values.get(child)) <= 0) break;
      this.values.set(index, this.values.get(child));
      index = child;
    }
    this.values.set(index, last);
    return first;
  }
}
export class BoundedCandidates {
  private readonly queue = new PriorityQueue<{ index: number; score: number }>(
    (a, b) => a.score - b.score || b.index - a.index
  );
  constructor(private readonly capacity: number) {}
  consider(index: number, score: number) {
    if (this.queue.count < this.capacity) {
      this.queue.push({ index, score });
      return;
    }
    const weakest = this.queue.peek();
    if (score < weakest.score || (score === weakest.score && index >= weakest.index)) return;
    this.queue.pop();
    this.queue.push({ index, score });
  }
  bestIndexes(): number[] {
    const selected = [];
    while (this.queue.count) selected.push(this.queue.pop());
    return selected.sort((a, b) => b.score - a.score || a.index - b.index).map((v) => v.index);
  }
}
