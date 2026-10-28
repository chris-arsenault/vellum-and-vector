/** Disjoint sets over a dense index range. Inactive entries hold -1 until made. */
export class UnionFind {
  readonly parent: Int32Array;
  readonly size: Int32Array;
  constructor(count: number) {
    this.parent = new Int32Array(count).fill(-1);
    this.size = new Int32Array(count);
  }
  active(i: number) {
    return this.parent[i] >= 0;
  }
  make(i: number) {
    this.parent[i] = i;
    this.size[i] = 1;
  }
  /** Root with path halving. */
  find(i: number): number {
    const parent = this.parent;
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  /** Union by size; returns the surviving root. */
  union(a: number, b: number): number {
    a = this.find(a);
    b = this.find(b);
    if (a === b) return a;
    if (this.size[a] < this.size[b]) [a, b] = [b, a];
    this.parent[b] = a;
    this.size[a] += this.size[b];
    return a;
  }
  /** Attach b's root under a's root regardless of size, for callers with their own rule. */
  attach(a: number, b: number): number {
    a = this.find(a);
    b = this.find(b);
    if (a === b) return a;
    this.parent[b] = a;
    this.size[a] += this.size[b];
    return a;
  }
}
