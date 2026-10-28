import type { NumericalVector } from "@atlas/domain";
import type { TriangleIndex } from "./mesh";
import { latticeSlot, type LatticeFrame, type LatticeRows } from "./latticeRows";

/** Row addressing: one slot per lattice candidate, no map entry and no string key. */
export class LatticeIndex implements TriangleIndex {
  constructor(
    private rows: LatticeRows,
    private indexes: NumericalVector,
    private frame: LatticeFrame,
    private periodicColumns: number | null
  ) {}
  at(u: number, v: number, inverted: boolean) {
    if (!Number.isSafeInteger(u) || !Number.isSafeInteger(v)) return undefined;
    if (this.periodicColumns) {
      const x = (1.5 * (u + v) + (inverted ? 2 : 1)) * this.frame.spacing + this.frame.offset[0];
      const shift =
        Math.floor((x + this.frame.width / 2) / this.frame.width) * this.periodicColumns;
      u -= shift;
      v -= shift;
    }
    const slot = latticeSlot(this.rows, u, v, inverted);
    if (slot < 0) return undefined;
    const value = this.indexes[slot];
    return value < 0 ? undefined : value;
  }
}
