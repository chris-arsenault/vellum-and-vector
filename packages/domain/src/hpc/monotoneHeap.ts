import { requireThat } from "../errors";
import { grown } from "./growth";
import { keyFromOrdered, orderedHi, orderedLess, orderedLo } from "./keyBits";

interface Bucket {
  items: Int32Array;
  hi: Uint32Array;
  lo: Uint32Array;
  count: number;
}
const bucketCount = 65;
function bucket(capacity: number): Bucket {
  return {
    items: new Int32Array(capacity),
    hi: new Uint32Array(capacity),
    lo: new Uint32Array(capacity),
    count: 0,
  };
}
/** Radix heap over float64 keys for monotone frontiers: every key pushed is at or beyond the
 * last key popped. Push is O(1); pop is amortized O(log of the key spread). Entries equal to
 * the current minimum sit in a FIFO lane and never touch the buckets. Items are ints. */
export class MonotoneHeap {
  private buckets: Bucket[];
  private head = 0;
  private lastHi: number;
  private lastLo: number;
  private lastKey = NaN;
  private count = 0;
  private readonly sign: number;
  constructor(order: "min" | "max" = "min", capacity = 1024) {
    this.sign = order === "min" ? 1 : -1;
    this.buckets = Array.from({ length: bucketCount }, (_, i) =>
      bucket(i === 0 ? Math.max(16, capacity) : 16)
    );
    this.lastHi = orderedHi(-Infinity);
    this.lastLo = orderedLo();
  }
  get size() {
    return this.count;
  }
  /** The key of the item most recently popped. */
  key() {
    return this.lastKey;
  }
  push(item: number, key: number) {
    const hi = orderedHi(key * this.sign),
      lo = orderedLo();
    requireThat(
      !orderedLess(hi, lo, this.lastHi, this.lastLo),
      "heap_monotone",
      "A monotone heap cannot accept a key before the last popped key."
    );
    this.add(this.bucketIndex(hi, lo), item, hi, lo);
    this.count++;
  }
  pop(): number {
    if (this.count === 0) return -1;
    const lane = this.buckets[0];
    if (this.head === lane.count) this.refill();
    const at = this.head++;
    this.count--;
    this.lastKey = keyFromOrdered(lane.hi[at], lane.lo[at]) * this.sign;
    return lane.items[at];
  }
  private add(index: number, item: number, hi: number, lo: number) {
    const b = this.buckets[index];
    if (b.count === b.items.length) {
      b.items = grown(b.items, b.count + 1);
      b.hi = grown(b.hi, b.count + 1);
      b.lo = grown(b.lo, b.count + 1);
    }
    b.items[b.count] = item;
    b.hi[b.count] = hi;
    b.lo[b.count] = lo;
    b.count++;
  }
  /** 0 when equal to the last popped key, else one past the highest differing bit. */
  private bucketIndex(hi: number, lo: number) {
    if (hi !== this.lastHi) return 33 + (31 - Math.clz32((hi ^ this.lastHi) >>> 0));
    if (lo !== this.lastLo) return 1 + (31 - Math.clz32((lo ^ this.lastLo) >>> 0));
    return 0;
  }
  /** Move the lowest non-empty bucket down around its minimum; its minimum lands in lane 0. */
  private refill() {
    this.buckets[0].count = 0;
    this.head = 0;
    let index = 1;
    while (this.buckets[index].count === 0) index++;
    const source = this.buckets[index];
    let minHi = source.hi[0],
      minLo = source.lo[0];
    for (let i = 1; i < source.count; i++)
      if (orderedLess(source.hi[i], source.lo[i], minHi, minLo)) {
        minHi = source.hi[i];
        minLo = source.lo[i];
      }
    this.lastHi = minHi;
    this.lastLo = minLo;
    const items = source.items,
      hi = source.hi,
      lo = source.lo,
      count = source.count;
    source.count = 0;
    for (let i = 0; i < count; i++)
      this.add(this.bucketIndex(hi[i], lo[i]), items[i], hi[i], lo[i]);
  }
}
