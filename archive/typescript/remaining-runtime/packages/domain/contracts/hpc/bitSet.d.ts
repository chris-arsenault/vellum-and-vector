/** One bit per index in 32-bit words. */
export declare class BitSet {
  readonly length: number;
  readonly words: Uint32Array;
  constructor(length: number);
  has(i: number): boolean;
  set(i: number): void;
  clear(i: number): void;
  /** Sets the bit; returns whether it was clear before. */
  add(i: number): boolean;
  clearAll(): void;
  count(): number;
  /** The first set index at or after `from`, or -1. */
  nextSet(from: number): number;
  forEach(visit: (i: number) => void): void;
}
export declare function popcount(word: number): number;
