/** FIFO of cell indices in one growable ring buffer. Empty shift returns -1. */
export declare class CellQueue {
  private values;
  private head;
  private count;
  constructor(capacity?: number);
  get size(): number;
  push(cell: number): void;
  shift(): number;
  clear(): void;
  private grow;
}
