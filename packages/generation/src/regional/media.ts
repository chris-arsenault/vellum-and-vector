import { isMutablePhysicalName, type PhysicalBufferName, type PhysicalField } from "../world/field";
import { displaceGround, looseTo } from "../rock/groundLedger";
import { alterRock } from "../rock/rockField";

/** Material quantities stay nonnegative; covers and per-mille intensities keep their scales. */
export const ledgerFloors: Partial<Record<PhysicalBufferName, number>> = {
  RockResistance: 0,
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
  SedimentThickness: 0,
  WaterDepths: 0,
};
export const ledgerCeilings: Partial<Record<PhysicalBufferName, number>> = {
  FractureConductance: 1000,
  ExternalCoastalForcing: 1000,
  Moisture: 1000,
  BroadleafCover: 1,
  ConiferCover: 1,
  GrassCover: 1,
};

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

/** Ground changes land through its owner; external ecology and ice retain their own bands. */
function applyContribution(
  map: PhysicalField,
  name: PhysicalBufferName,
  cell: number,
  next: number
) {
  const delta = next - map[name].get(cell);
  if (name === "Elevation" || name === "BedrockElevation")
    displaceGround(map, cell, delta, "contributions");
  else if (name === "RockResistance") alterRock(map, cell, delta);
  else if (name === "SedimentThickness") looseTo(map, cell, next, "contributions");
  else if (isMutablePhysicalName(name)) map[name].set(cell, next);
  else throw new Error(`Ground contribution requires an owner operation: ${name}`);
}

export class Contributions {
  private readonly applied = new Map<PhysicalBufferName, Float64Array>();
  private readonly desired = new Map<PhysicalBufferName, Float64Array>();
  constructor(private readonly length: number) {}

  /** Begin declaring this evaluation's totals; every band starts from zero. */
  begin() {
    for (const values of this.desired.values()) values.fill(0);
  }
  /** Another process rewrote `band`: nothing this ledger applied remains in it. */
  forget(band: PhysicalBufferName) {
    this.applied.delete(band);
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
        applyContribution(map, name, i, next);
        // What the band could take is what was applied; a bound keeps the ledger honest.
        previous[i] += target.get(i) - before;
      }
    }
    return changed;
  }
}
