/** A set of a few ints, linear scan, no hashing; for per-cell neighbour-root collections. */
export declare class SmallIntSet {
  private values;
  private count;
  constructor(capacity?: number);
  get size(): number;
  has(value: number): boolean;
  /** Adds the value; returns whether it was absent. */
  add(value: number): boolean;
  at(index: number): number;
  clear(): void;
  /** The members as a view, for sorting or iteration without allocation. */
  items(): Int32Array<ArrayBufferLike>;
}
