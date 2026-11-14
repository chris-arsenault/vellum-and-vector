import { requireThat } from "../errors";

/** FIFO of cells with up to four float fields in parallel rings. No record object: shift()
 * returns the cell and field(k) reads that record's fields until the next shift. */
export class RecordQueue {
  private cells: Int32Array;
  private fields: Float64Array[];
  private head = 0;
  private count = 0;
  private current = -1;
  constructor(
    readonly fieldCount: number,
    capacity = 1024
  ) {
    requireThat(
      Number.isInteger(fieldCount) && fieldCount >= 0 && fieldCount <= 4,
      "record_fields",
      "A record queue carries up to four float fields."
    );
    const length = Math.max(16, capacity);
    this.cells = new Int32Array(length);
    this.fields = Array.from({ length: fieldCount }, () => new Float64Array(length));
  }
  get size() {
    return this.count;
  }
  push(cell: number, f0 = 0, f1 = 0, f2 = 0, f3 = 0) {
    if (this.count === this.cells.length) this.grow();
    let at = this.head + this.count;
    if (at >= this.cells.length) at -= this.cells.length;
    this.cells[at] = cell;
    this.store(at, f0, f1, f2, f3);
    this.count++;
  }
  private store(at: number, f0: number, f1: number, f2: number, f3: number) {
    const fields = this.fields;
    switch (fields.length) {
      case 4:
        fields[3][at] = f3;
      // falls through
      case 3:
        fields[2][at] = f2;
      // falls through
      case 2:
        fields[1][at] = f1;
      // falls through
      case 1:
        fields[0][at] = f0;
    }
  }
  /** The next cell, or -1. Its fields stay readable through field(k). */
  shift(): number {
    if (this.count === 0) return -1;
    this.current = this.head;
    this.head = this.head + 1 === this.cells.length ? 0 : this.head + 1;
    this.count--;
    return this.cells[this.current];
  }
  field(k: number): number {
    return this.fields[k][this.current];
  }
  clear() {
    this.head = 0;
    this.count = 0;
    this.current = -1;
  }
  private grow() {
    const length = this.cells.length,
      tail = length - this.head;
    const rotate = <T extends Int32Array | Float64Array>(values: T): T => {
      const Constructor = values.constructor as new (n: number) => T;
      const next = new Constructor(length * 2);
      next.set(values.subarray(this.head), 0);
      next.set(values.subarray(0, this.head), tail);
      return next;
    };
    this.cells = rotate(this.cells);
    this.fields = this.fields.map(rotate);
    this.head = 0;
  }
}
