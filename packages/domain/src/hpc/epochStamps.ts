/** Per-index marks cleared in O(1) by advancing an epoch. Optionally pairs a value column
 * that reads as `fallback` for indices not marked in the current epoch. */
export class EpochStamps {
  private readonly stamps: Int32Array;
  private epoch = 1;
  readonly values: Float64Array | null;
  constructor(
    readonly length: number,
    withValues = false
  ) {
    this.stamps = new Int32Array(length);
    this.values = withValues ? new Float64Array(length) : null;
  }
  /** Start a new pass: every index reads as unmarked. */
  begin() {
    if (this.epoch === 0x7fffffff) {
      this.stamps.fill(0);
      this.epoch = 1;
      return;
    }
    this.epoch++;
  }
  marked(i: number) {
    return this.stamps[i] === this.epoch;
  }
  /** Marks the index; returns whether it was unmarked in this pass. */
  mark(i: number) {
    if (this.stamps[i] === this.epoch) return false;
    this.stamps[i] = this.epoch;
    return true;
  }
  set(i: number, value: number) {
    this.stamps[i] = this.epoch;
    this.values![i] = value;
  }
  get(i: number, fallback: number) {
    return this.stamps[i] === this.epoch ? this.values![i] : fallback;
  }
}
