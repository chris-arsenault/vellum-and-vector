import type { PhysicalBufferName, PhysicalField } from "../canonry/field";

/**
 * Tracked physical contributions to the field's bands, in their native units. A process that
 * changes a shared medium (magic lowering a coast, opening fractures, deepening soil) declares
 * the total it wants applied; the tracker writes only the difference from what it applied
 * before. Re-evaluating a round therefore updates the contribution instead of adding it again
 * (spec 7.3).
 */
/** A band's bounds and integer-ness as one clamp. */
function bounded(minimum: number | undefined, maximum: number | undefined, integer: boolean) {
  return (value: number) => {
    let next = value;
    if (minimum !== undefined) next = Math.max(minimum, next);
    if (maximum !== undefined) next = Math.min(maximum, next);
    return integer ? Math.round(next) : next;
  };
}

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
  commit(
    map: PhysicalField,
    floor: Partial<Record<PhysicalBufferName, number>> = {},
    ceiling: Partial<Record<PhysicalBufferName, number>> = {}
  ) {
    const changed = new Map<PhysicalBufferName, number>();
    for (const [name, wanted] of this.desired) {
      const target = map[name];
      let previous = this.applied.get(name);
      if (!previous) {
        previous = new Float64Array(this.length);
        this.applied.set(name, previous);
      }
      const bound = bounded(floor[name], ceiling[name], target.type === "int32");
      for (let i = 0; i < this.length; i++) {
        const delta = wanted[i] - previous[i];
        if (!delta) continue;
        changed.set(name, Math.max(changed.get(name) ?? 0, Math.abs(delta)));
        const before = target.get(i),
          next = bound(before + delta);
        target.set(i, next);
        // What the band could take is what was applied; a bound keeps the ledger honest.
        previous[i] += next - before;
      }
    }
    return changed;
  }
}
