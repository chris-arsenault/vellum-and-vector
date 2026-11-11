import { type MutablePhysicalBufferName, type PhysicalField } from "../world/field";

/** Material quantities stay nonnegative; covers and per-mille intensities keep their scales. */
export const ledgerFloors: Partial<Record<MutablePhysicalBufferName, number>> = {
  FractureConductance: 0,
  SoilDepth: 0,
  Moisture: 0,
  IceThickness: 0,
  ExternalCoastalForcing: 0,
  BroadleafCover: 0,
  ConiferCover: 0,
  GrassCover: 0,
  WetlandCover: 0,
  TreeCover: 0,
  BroadleafSaplings: 0,
  SoilWater: 0,
  AquaticProductivity: 0,
  WaterDepths: 0,
};
export const ledgerCeilings: Partial<Record<MutablePhysicalBufferName, number>> = {
  FractureConductance: 1000,
  ExternalCoastalForcing: 1000,
  Moisture: 1000,
  BroadleafCover: 1,
  ConiferCover: 1,
  GrassCover: 1,
};

/**
 * Tracked external contributions to mutable media, in their native units. A process that
 * changes a shared medium (opening fractures or clearing vegetation) declares
 * the total it wants applied; the tracker writes only the difference from what it applied
 * before. Re-evaluating a round therefore updates the contribution instead of adding it again
 * Ground and material are excluded: their effects are persistent owner operations.
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
  private readonly desired = new Map<MutablePhysicalBufferName, Float64Array>();
  /** `applied` is what earlier evaluations wrote: supply the run's own table to carry it on. */
  constructor(
    private readonly length: number,
    private readonly applied = new Map<MutablePhysicalBufferName, Float64Array>()
  ) {}

  /** Begin declaring this evaluation's totals; every band starts from zero. */
  begin() {
    for (const values of this.desired.values()) values.fill(0);
  }
  /** Another process rewrote `band`: nothing this ledger applied remains in it. */
  forget(band: MutablePhysicalBufferName) {
    this.applied.delete(band);
  }
  /** Declare part of the total change this evaluation wants on `band` at `i`. */
  add(band: MutablePhysicalBufferName, i: number, amount: number) {
    if (!amount) return;
    let values = this.desired.get(band);
    if (!values) {
      values = new Float64Array(this.length);
      this.desired.set(band, values);
    }
    values[i] += amount;
  }
  /** The total currently applied to `band` at `i`. */
  appliedTo(band: MutablePhysicalBufferName, i: number) {
    return this.applied.get(band)?.[i] ?? 0;
  }
  /**
   * Write each band's declared total, replacing what the previous evaluation applied.
   * Returns, per band whose applied total changed, the largest change at any cell.
   */
  commit(
    map: PhysicalField,
    floor: Partial<Record<MutablePhysicalBufferName, number>> = {},
    ceiling: Partial<Record<MutablePhysicalBufferName, number>> = {}
  ) {
    const changed = new Map<MutablePhysicalBufferName, number>();
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
        previous[i] += target.get(i) - before;
      }
    }
    return changed;
  }
}
