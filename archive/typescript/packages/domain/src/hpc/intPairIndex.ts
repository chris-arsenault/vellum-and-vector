import { EpochStamps } from "./epochStamps";
import { grown } from "./growth";

/** Dense identities for int32 pairs, with typed open addressing and constant-time clearing. */
export class IntPairIndex {
  private a = new Int32Array(16);
  private b = new Int32Array(16);
  private slots = new Int32Array(32);
  private stamps = new EpochStamps(32);
  length = 0;
  first(index: number) {
    return this.a[index];
  }
  second(index: number) {
    return this.b[index];
  }
  clear() {
    this.length = 0;
    this.stamps.begin();
  }
  private slot(a: number, b: number) {
    const mask = this.slots.length - 1;
    let at = (Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca6b)) & mask;
    while (this.stamps.marked(at)) {
      const index = this.slots[at];
      if (this.a[index] === a && this.b[index] === b) return at;
      at = (at + 1) & mask;
    }
    return at;
  }
  include(a: number, b: number) {
    let at = this.slot(a, b);
    if (this.stamps.marked(at)) return this.slots[at];
    if (this.length * 2 >= this.slots.length) {
      this.grow();
      at = this.slot(a, b);
    }
    const index = this.length++;
    this.a = grown(this.a, this.length);
    this.b = grown(this.b, this.length);
    this.a[index] = a;
    this.b[index] = b;
    this.slots[at] = index;
    this.stamps.mark(at);
    return index;
  }
  private grow() {
    this.slots = new Int32Array(this.slots.length * 2);
    this.stamps = new EpochStamps(this.slots.length);
    for (let index = 0; index < this.length; index++) {
      const at = this.slot(this.a[index], this.b[index]);
      this.slots[at] = index;
      this.stamps.mark(at);
    }
  }
}
