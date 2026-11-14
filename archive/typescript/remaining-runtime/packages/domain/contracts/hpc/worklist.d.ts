/** A FIFO that holds each index at most once; `take` releases membership so the index can be
 * queued again after it is processed. */
export declare class Worklist {
  private readonly queue;
  private readonly queued;
  constructor(length: number, capacity?: number);
  get size(): number;
  /** Queues the index unless it is already waiting; returns whether it was added. */
  add(i: number): boolean;
  take(): number;
  /** Queue every index once, in order. */
  fill(count: number): void;
}
