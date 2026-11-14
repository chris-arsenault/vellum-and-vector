import { requireThat } from "../errors";
import { grown } from "./growth";

/** Binary heap on int items ordered by up to four float keys, each ascending or descending,
 * then by ascending item. For frontiers whose order is composite or not monotone. */
export class MultiKeyHeap {
  private items: Int32Array;
  private keys: Float64Array;
  private count = 0;
  private readonly signs: Float64Array;
  private readonly width: number;
  private popped: Float64Array;
  constructor(directions: ("asc" | "desc")[], capacity = 256) {
    requireThat(
      directions.length >= 1 && directions.length <= 4,
      "heap_keys",
      "A multi-key heap orders by one to four keys."
    );
    this.width = directions.length;
    this.signs = Float64Array.from(directions, (d) => (d === "asc" ? 1 : -1));
    this.items = new Int32Array(Math.max(16, capacity));
    this.keys = new Float64Array(this.items.length * this.width);
    this.popped = new Float64Array(this.width);
  }
  get size() {
    return this.count;
  }
  /** Key j of the item most recently popped. */
  key(j: number) {
    return this.popped[j];
  }
  private before(a: number, b: number) {
    const w = this.width,
      keys = this.keys;
    for (let j = 0; j < w; j++) {
      const x = keys[a * w + j] * this.signs[j],
        y = keys[b * w + j] * this.signs[j];
      if (x !== y) return x < y;
    }
    return this.items[a] < this.items[b];
  }
  private swap(a: number, b: number) {
    const item = this.items[a];
    this.items[a] = this.items[b];
    this.items[b] = item;
    const w = this.width;
    for (let j = 0; j < w; j++) {
      const key = this.keys[a * w + j];
      this.keys[a * w + j] = this.keys[b * w + j];
      this.keys[b * w + j] = key;
    }
  }
  push(item: number, k0: number, k1 = 0, k2 = 0, k3 = 0) {
    if (this.count === this.items.length) {
      this.items = grown(this.items, this.count + 1);
      this.keys = grown(this.keys, (this.count + 1) * this.width);
    }
    let at = this.count++;
    const w = this.width,
      base = at * w;
    this.items[at] = item;
    this.keys[base] = k0;
    if (w > 1) this.keys[base + 1] = k1;
    if (w > 2) this.keys[base + 2] = k2;
    if (w > 3) this.keys[base + 3] = k3;
    while (at > 0) {
      const parent = (at - 1) >>> 1;
      if (!this.before(at, parent)) break;
      this.swap(at, parent);
      at = parent;
    }
  }
  pop(): number {
    if (this.count === 0) return -1;
    const top = this.items[0],
      w = this.width;
    for (let j = 0; j < w; j++) this.popped[j] = this.keys[j];
    this.count--;
    if (this.count > 0) {
      this.swap(0, this.count);
      this.siftDown();
    }
    return top;
  }
  private siftDown() {
    let at = 0;
    for (;;) {
      let child = at * 2 + 1;
      if (child >= this.count) break;
      if (child + 1 < this.count && this.before(child + 1, child)) child++;
      if (!this.before(child, at)) break;
      this.swap(at, child);
      at = child;
    }
  }
}
