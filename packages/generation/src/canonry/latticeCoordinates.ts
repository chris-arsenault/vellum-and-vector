import type { NumericalVector } from "@atlas/domain";
import type { TriangleCoord, TriangleCoordinates, TriangleIndex } from "./mesh";
import { latticeSlot, type LatticeFrame, type LatticeRows } from "./latticeRows";

/** Coordinates are numerical columns; indexing creates one short-lived coordinate value. */
export class LatticeCoordinates implements TriangleCoordinates {
  readonly [index: number]: TriangleCoord;
  readonly view: TriangleCoordinates;
  readonly length: number;
  constructor(
    readonly u: NumericalVector,
    readonly v: NumericalVector,
    readonly inverted: NumericalVector
  ) {
    this.length = u.length;
    this.view = new Proxy(this, {
      get: (target, property) => {
        if (typeof property === "string") {
          const index = Number(property);
          if (Number.isSafeInteger(index) && String(index) === property)
            return index >= 0 && index < target.length ? target.read(index) : undefined;
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }
  private read(index: number): TriangleCoord {
    return { u: this.u[index], v: this.v[index], inverted: !!this.inverted[index] };
  }
  forEach(visit: (p: TriangleCoord, index: number) => void) {
    for (let i = 0; i < this.length; i++) visit(this.read(i), i);
  }
  findIndex(predicate: (p: TriangleCoord, index: number) => boolean) {
    for (let i = 0; i < this.length; i++) if (predicate(this.read(i), i)) return i;
    return -1;
  }
  *[Symbol.iterator]() {
    for (let i = 0; i < this.length; i++) yield this.read(i);
  }
}
/** Row addressing replaces one string-keyed map entry per triangle. */
export class LatticeIndex implements TriangleIndex {
  constructor(
    private rows: LatticeRows,
    private indexes: NumericalVector,
    private frame: LatticeFrame,
    private periodicColumns: number | null
  ) {}
  get(key: string) {
    const parts = key.split(":"),
      [u, v, inverted] = parts.map(Number);
    if (
      parts.length !== 3 ||
      ![0, 1].includes(inverted) ||
      String(u) !== parts[0] ||
      String(v) !== parts[1]
    )
      return undefined;
    return this.at(u, v, !!inverted);
  }
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
