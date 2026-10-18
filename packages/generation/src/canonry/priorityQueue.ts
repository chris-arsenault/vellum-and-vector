// Binary heap for the priority-queue operations used by Canonry's C# layers.
export class PriorityQueue<T> {
  private readonly values: T[] = [];
  constructor(private readonly compare: (a: T, b: T) => number) {}
  get count() {
    return this.values.length;
  }
  peek(): T {
    return this.values[0];
  }
  push(value: T) {
    let index = this.values.length;
    this.values.push(value);
    while (index > 0) {
      const parent = (index - 1) >>> 1;
      if (this.compare(value, this.values[parent]) >= 0) break;
      this.values[index] = this.values[parent];
      index = parent;
    }
    this.values[index] = value;
  }
  pop(): T {
    const first = this.values[0],
      last = this.values.pop()!;
    if (!this.values.length) return first;
    let index = 0;
    while (index * 2 + 1 < this.values.length) {
      let child = index * 2 + 1;
      if (
        child + 1 < this.values.length &&
        this.compare(this.values[child + 1], this.values[child]) < 0
      )
        child++;
      if (this.compare(last, this.values[child]) <= 0) break;
      this.values[index] = this.values[child];
      index = child;
    }
    this.values[index] = last;
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
