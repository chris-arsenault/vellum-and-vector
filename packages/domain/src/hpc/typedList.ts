import { grown } from "./growth";

/** Append-only list over one growable typed array. finish() returns a view of the written
 * prefix; the list must not be pushed to afterwards. */
class TypedList<T extends Int32Array | Float64Array> {
  protected values: T;
  length = 0;
  constructor(values: T) {
    this.values = values;
  }
  push(value: number) {
    if (this.length === this.values.length) this.values = grown(this.values, this.length + 1);
    this.values[this.length++] = value;
  }
  at(index: number) {
    return this.values[index];
  }
  set(index: number, value: number) {
    this.values[index] = value;
  }
  finish(): T {
    return this.values.subarray(0, this.length) as T;
  }
  clear() {
    this.length = 0;
  }
}
export class CellList extends TypedList<Int32Array> {
  constructor(capacity = 64) {
    super(new Int32Array(Math.max(16, capacity)));
  }
  /** Ascending numeric order in place, native sort. */
  sort() {
    this.values.subarray(0, this.length).sort();
    return this;
  }
}
export class FloatList extends TypedList<Float64Array> {
  constructor(capacity = 64) {
    super(new Float64Array(Math.max(16, capacity)));
  }
}
