import { requireThat, type NumericalAllocator, type NumericalVector } from "@atlas/domain";

export interface HeapStorage<T> {
  readonly length: number;
  get(index: number): T;
  set(index: number, value: T): void;
  push(value: T): void;
  pop(): T;
  close(): void;
}
export class NativeHeapStorage<T> implements HeapStorage<T> {
  private values: T[] = [];
  get length() {
    return this.values.length;
  }
  get(index: number) {
    return this.values[index];
  }
  set(index: number, value: T) {
    this.values[index] = value;
  }
  push(value: T) {
    this.values.push(value);
  }
  pop() {
    return this.values.pop()!;
  }
  close() {
    this.values = [];
  }
}
const queueChunkEntries = 16_384;
/** Transient decoded records sit above paged columns; the queue retains no object per entry. */
export class NumericHeapStorage<T extends Record<string, number>> implements HeapStorage<T> {
  private chunks: NumericalVector[][] = [];
  private count = 0;
  constructor(
    private numerical: NumericalAllocator,
    private fields: readonly (keyof T)[]
  ) {
    requireThat(fields.length > 0, "queue_columns", "A numerical queue declares its columns.");
  }
  get length() {
    return this.count;
  }
  get(index: number): T {
    const chunk = this.chunks[Math.floor(index / queueChunkEntries)],
      result = {} as T;
    for (let column = 0; column < this.fields.length; column++)
      result[this.fields[column]] = chunk[column][index % queueChunkEntries] as T[keyof T];
    return result;
  }
  set(index: number, value: T) {
    const chunk = this.chunks[Math.floor(index / queueChunkEntries)];
    for (let column = 0; column < this.fields.length; column++)
      chunk[column][index % queueChunkEntries] = value[this.fields[column]];
  }
  push(value: T) {
    if (this.count === this.chunks.length * queueChunkEntries)
      this.chunks.push(
        this.fields.map((name) =>
          this.numerical.allocate({
            type: "float64",
            length: queueChunkEntries,
            lifetime: "process",
            name: `queue:${String(name)}`,
          })
        )
      );
    this.set(this.count++, value);
  }
  pop() {
    const value = this.get(--this.count);
    if (Math.ceil(this.count / queueChunkEntries) < this.chunks.length)
      for (const column of this.chunks.pop()!) this.numerical.release(column);
    return value;
  }
  close() {
    for (const chunk of this.chunks) for (const column of chunk) this.numerical.release(column);
    this.chunks = [];
    this.count = 0;
  }
}
