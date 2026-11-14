/** Binary heap on int items with float keys; no objects, no comparator closure.
 * Ties break on item index, lower first unless `tie` says otherwise. */
export declare class KeyedHeap {
  private items;
  private keys;
  private count;
  private readonly sign;
  private readonly tieSign;
  constructor(order?: "min" | "max", tie?: "lower-first" | "higher-first", capacity?: number);
  get size(): number;
  peekKey(): number;
  peekItem(): number;
  /** Whether entry a should pop before entry b. */
  private before;
  push(item: number, key: number): void;
  /** Removes and returns the top item; its key is readable through poppedKey(). */
  private lastKey;
  poppedKey(): number;
  pop(): number;
  private siftDown;
}
/** Keeps the k strongest (highest score; ties to the lower index) without sorting the rest. */
export declare class TopK {
  readonly capacity: number;
  private heap;
  constructor(capacity: number);
  consider(item: number, score: number): void;
  /** Strongest first. Drains the selection. */
  best(): Int32Array;
}
