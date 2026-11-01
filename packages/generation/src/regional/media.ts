import type { PhysicalBufferName, PhysicalField } from "../canonry/field";

/**
 * Tracked physical contributions to the field's bands, in their native units. A process that
 * changes a shared medium (magic lowering a coast, opening fractures, deepening soil) declares
 * the total it wants applied; the tracker writes only the difference from what it applied
 * before. Re-evaluating a round therefore updates the contribution instead of adding it again
 * (spec 7.3).
 */
export class Contributions {
  private readonly applied = new Map<PhysicalBufferName, Float64Array>();
  private readonly desired = new Map<PhysicalBufferName, Float64Array>();
  constructor(private readonly length: number) {}

  /** Begin declaring this evaluation's totals; every band starts from zero. */
  begin() {
    for (const values of this.desired.values()) values.fill(0);
  }
  /** Declare part of the total change this evaluation wants on `band` at `i`. */
  add(band: PhysicalBufferName, i: number, amount: number) {
    if (!amount) return;
    let values = this.desired.get(band);
    if (!values) {
      values = new Float64Array(this.length);
      this.desired.set(band, values);
    }
    values[i] += amount;
  }
  /** The total currently applied to `band` at `i`. */
  appliedTo(band: PhysicalBufferName, i: number) {
    return this.applied.get(band)?.[i] ?? 0;
  }
  /**
   * Write each band's declared total, replacing what the previous evaluation applied.
   * Returns, per band whose applied total changed, the largest change at any cell.
   */
  commit(map: PhysicalField, floor: Partial<Record<PhysicalBufferName, number>> = {}) {
    const changed = new Map<PhysicalBufferName, number>();
    for (const [name, wanted] of this.desired) {
      const target = map[name];
      let previous = this.applied.get(name);
      if (!previous) {
        previous = new Float64Array(this.length);
        this.applied.set(name, previous);
      }
      const minimum = floor[name],
        integer = target.type === "int32";
      for (let i = 0; i < this.length; i++) {
        const delta = wanted[i] - previous[i];
        if (!delta) continue;
        changed.set(name, Math.max(changed.get(name) ?? 0, Math.abs(delta)));
        let next = target.get(i) + delta;
        if (minimum !== undefined) next = Math.max(minimum, next);
        target.set(i, integer ? Math.round(next) : next);
        previous[i] = wanted[i];
      }
    }
    return changed;
  }
}
