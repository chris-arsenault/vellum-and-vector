/** A set of a few ints, linear scan, no hashing; for per-cell neighbour-root collections. */
export class SmallIntSet {
  private values: Int32Array;
  private count = 0;
  constructor(capacity = 16) {
    this.values = new Int32Array(Math.max(4, capacity));
  }
  get size() {
    return this.count;
  }
  has(value: number) {
    for (let i = 0; i < this.count; i++) if (this.values[i] === value) return true;
    return false;
  }
  /** Adds the value; returns whether it was absent. */
  add(value: number) {
    if (this.has(value)) return false;
    if (this.count === this.values.length) {
      const next = new Int32Array(this.values.length * 2);
      next.set(this.values);
      this.values = next;
    }
    this.values[this.count++] = value;
    return true;
  }
  at(index: number) {
    return this.values[index];
  }
  clear() {
    this.count = 0;
  }
  /** The members as a view, for sorting or iteration without allocation. */
  items() {
    return this.values.subarray(0, this.count);
  }
}
