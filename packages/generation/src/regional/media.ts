import type { Band } from "@atlas/domain";

/**
 * Tracked physical contributions. A process that changes a shared medium (magic lowering a
 * coast, opening fractures, deepening soil) declares the total it wants applied; the
 * tracker writes only the difference from what it applied before. Re-evaluating a round
 * therefore updates the contribution instead of adding it again (spec 7.3).
 */
export class Contributions {
  private readonly applied = new Map<string, Float64Array>();
  private readonly desired = new Map<string, Float64Array>();
  constructor(private readonly length: number) {}

  /** Begin declaring this evaluation's totals; every channel starts from zero. */
  begin() {
    for (const values of this.desired.values()) values.fill(0);
  }
  /** Declare part of the total change this evaluation wants on `channel` at `i`. */
  add(channel: string, i: number, amount: number) {
    if (!amount) return;
    let values = this.desired.get(channel);
    if (!values) {
      values = new Float64Array(this.length);
      this.desired.set(channel, values);
    }
    values[i] += amount;
  }
  /** The total currently applied to `channel` at `i`. */
  appliedTo(channel: string, i: number) {
    return this.applied.get(channel)?.[i] ?? 0;
  }
  /**
   * Write each channel's declared total, replacing what the previous evaluation applied.
   * Returns, per channel whose applied total changed, the largest change at any cell.
   */
  commit(channels: Record<string, Band>, floor: Record<string, number> = {}) {
    const changed = new Map<string, number>();
    for (const [channel, wanted] of this.desired) {
      const target = channels[channel];
      if (!target) continue;
      let previous = this.applied.get(channel);
      if (!previous) {
        previous = new Float64Array(this.length);
        this.applied.set(channel, previous);
      }
      const minimum = floor[channel];
      for (let i = 0; i < this.length; i++) {
        const delta = wanted[i] - previous[i];
        if (!delta) continue;
        changed.set(channel, Math.max(changed.get(channel) ?? 0, Math.abs(delta)));
        const next = target.get(i) + delta;
        target.set(i, minimum === undefined ? next : Math.max(minimum, next));
        previous[i] = wanted[i];
      }
    }
    return changed;
  }
}
