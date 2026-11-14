/** Append-only list over one growable typed array. finish() returns a view of the written
 * prefix; the list must not be pushed to afterwards. */
declare class TypedList<T extends Int32Array | Float64Array> {
  protected values: T;
  length: number;
  constructor(values: T);
  push(value: number): void;
  at(index: number): number;
  set(index: number, value: number): void;
  finish(): T;
  clear(): void;
  /** Replace the written prefix by one bulk copy; snapshots never share mutable storage. */
  copyFrom(values: ArrayLike<number>): void;
}
export declare class CellList extends TypedList<Int32Array> {
  constructor(capacity?: number);
  /** Ascending numeric order in place, native sort. */
  sort(): this;
}
export declare class FloatList extends TypedList<Float64Array> {
  constructor(capacity?: number);
}
export {};
