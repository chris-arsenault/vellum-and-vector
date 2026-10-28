import { BitSet } from "./bitSet";
import { CellQueue } from "./cellQueue";

/** A FIFO that holds each index at most once; `take` releases membership so the index can be
 * queued again after it is processed. */
export class Worklist {
  private readonly queue: CellQueue;
  private readonly queued: BitSet;
  constructor(length: number, capacity = 1024) {
    this.queue = new CellQueue(capacity);
    this.queued = new BitSet(length);
  }
  get size() {
    return this.queue.size;
  }
  /** Queues the index unless it is already waiting; returns whether it was added. */
  add(i: number) {
    if (!this.queued.add(i)) return false;
    this.queue.push(i);
    return true;
  }
  take(): number {
    const i = this.queue.shift();
    if (i >= 0) this.queued.clear(i);
    return i;
  }
  /** Queue every index once, in order. */
  fill(count: number) {
    for (let i = 0; i < count; i++) this.add(i);
  }
}
