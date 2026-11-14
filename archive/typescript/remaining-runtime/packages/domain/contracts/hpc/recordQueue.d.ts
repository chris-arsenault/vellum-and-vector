/** FIFO of cells with up to four float fields in parallel rings. No record object: shift()
 * returns the cell and field(k) reads that record's fields until the next shift. */
export declare class RecordQueue {
  readonly fieldCount: number;
  private cells;
  private fields;
  private head;
  private count;
  private current;
  constructor(fieldCount: number, capacity?: number);
  get size(): number;
  push(cell: number, f0?: number, f1?: number, f2?: number, f3?: number): void;
  private store;
  /** The next cell, or -1. Its fields stay readable through field(k). */
  shift(): number;
  field(k: number): number;
  clear(): void;
  private grow;
}
