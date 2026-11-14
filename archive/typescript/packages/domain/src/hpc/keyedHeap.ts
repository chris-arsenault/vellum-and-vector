import { grown } from "./growth";

/** Binary heap on int items with float keys; no objects, no comparator closure.
 * Ties break on item index, lower first unless `tie` says otherwise. */
export class KeyedHeap {
  private items: Int32Array;
  private keys: Float64Array;
  private count = 0;
  private readonly sign: number;
  private readonly tieSign: number;
  constructor(
    order: "min" | "max" = "min",
    tie: "lower-first" | "higher-first" = "lower-first",
    capacity = 256
  ) {
    this.sign = order === "min" ? 1 : -1;
    this.tieSign = tie === "lower-first" ? 1 : -1;
    this.items = new Int32Array(Math.max(16, capacity));
    this.keys = new Float64Array(this.items.length);
  }
  get size() {
    return this.count;
  }
  peekKey() {
    return this.keys[0];
  }
  peekItem() {
    return this.items[0];
  }
  /** Whether entry a should pop before entry b. */
  private before(keyA: number, itemA: number, keyB: number, itemB: number) {
    const a = keyA * this.sign,
      b = keyB * this.sign;
    if (a !== b) return a < b;
    return itemA * this.tieSign < itemB * this.tieSign;
  }
  push(item: number, key: number) {
    if (this.count === this.items.length) {
      this.items = grown(this.items, this.count + 1);
      this.keys = grown(this.keys, this.count + 1);
    }
    let at = this.count++;
    while (at > 0) {
      const parent = (at - 1) >>> 1;
      if (!this.before(key, item, this.keys[parent], this.items[parent])) break;
      this.items[at] = this.items[parent];
      this.keys[at] = this.keys[parent];
      at = parent;
    }
    this.items[at] = item;
    this.keys[at] = key;
  }
  /** Removes and returns the top item; its key is readable through poppedKey(). */
  private lastKey = NaN;
  poppedKey() {
    return this.lastKey;
  }
  pop(): number {
    if (this.count === 0) return -1;
    const top = this.items[0];
    this.lastKey = this.keys[0];
    this.count--;
    if (this.count > 0) this.siftDown(this.items[this.count], this.keys[this.count]);
    return top;
  }
  private siftDown(item: number, key: number) {
    let at = 0;
    for (;;) {
      let child = at * 2 + 1;
      if (child >= this.count) break;
      const right = child + 1;
      if (
        right < this.count &&
        this.before(this.keys[right], this.items[right], this.keys[child], this.items[child])
      )
        child = right;
      if (!this.before(this.keys[child], this.items[child], key, item)) break;
      this.items[at] = this.items[child];
      this.keys[at] = this.keys[child];
      at = child;
    }
    this.items[at] = item;
    this.keys[at] = key;
  }
}
/** Keeps the k strongest (highest score; ties to the lower index) without sorting the rest. */
export class TopK {
  private heap: KeyedHeap;
  constructor(readonly capacity: number) {
    // The weakest entry is on top: lowest score, and among equal scores the higher index.
    this.heap = new KeyedHeap("min", "higher-first", capacity + 1);
  }
  consider(item: number, score: number) {
    if (this.heap.size < this.capacity) {
      this.heap.push(item, score);
      return;
    }
    const weakestScore = this.heap.peekKey(),
      weakest = this.heap.peekItem();
    if (score < weakestScore || (score === weakestScore && item >= weakest)) return;
    this.heap.pop();
    this.heap.push(item, score);
  }
  /** Strongest first. Drains the selection. */
  best(): Int32Array {
    const result = new Int32Array(this.heap.size);
    for (let i = result.length - 1; i >= 0; i--) result[i] = this.heap.pop();
    return result;
  }
}
