/** FIFO of cell indices in one growable ring buffer. Empty shift returns -1. */
export class CellQueue {
  private values: Int32Array;
  private head = 0;
  private count = 0;
  constructor(capacity = 1024) {
    this.values = new Int32Array(Math.max(16, capacity));
  }
  get size() {
    return this.count;
  }
  push(cell: number) {
    if (this.count === this.values.length) this.grow();
    const at = this.head + this.count;
    this.values[at < this.values.length ? at : at - this.values.length] = cell;
    this.count++;
  }
  shift(): number {
    if (this.count === 0) return -1;
    const value = this.values[this.head];
    this.head = this.head + 1 === this.values.length ? 0 : this.head + 1;
    this.count--;
    return value;
  }
  clear() {
    this.head = 0;
    this.count = 0;
  }
  private grow() {
    const next = new Int32Array(this.values.length * 2);
    const tail = this.values.length - this.head;
    next.set(this.values.subarray(this.head), 0);
    next.set(this.values.subarray(0, this.head), tail);
    this.values = next;
    this.head = 0;
  }
}
