/** Per-index marks cleared in O(1) by advancing an epoch. Optionally pairs a value column
 * that reads as `fallback` for indices not marked in the current epoch. */
export declare class EpochStamps {
  readonly length: number;
  private readonly stamps;
  private epoch;
  readonly values: Float64Array | null;
  constructor(length: number, withValues?: boolean);
  /** Start a new pass: every index reads as unmarked. */
  begin(): void;
  marked(i: number): boolean;
  /** Marks the index; returns whether it was unmarked in this pass. */
  mark(i: number): boolean;
  set(i: number, value: number): void;
  get(i: number, fallback: number): number;
}
