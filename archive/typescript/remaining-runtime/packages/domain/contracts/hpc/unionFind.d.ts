/** Disjoint sets over a dense index range. Inactive entries hold -1 until made. */
export declare class UnionFind {
  readonly parent: Int32Array;
  readonly size: Int32Array;
  constructor(count: number);
  active(i: number): boolean;
  make(i: number): void;
  /** Root with path halving. */
  find(i: number): number;
  /** Union by size; returns the surviving root. */
  union(a: number, b: number): number;
  /** Attach b's root under a's root regardless of size, for callers with their own rule. */
  attach(a: number, b: number): number;
}
