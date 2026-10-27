import { allocateNumerical, type Bounds, type NumericalAllocator } from "@atlas/domain";
import { latticeRows, forEachLatticeCell, type LatticeFrame } from "./latticeRows";
import { LatticeCoordinates, LatticeIndex } from "./latticeCoordinates";

/** Classify candidates once, then write content and halo into compact numerical columns. */
export function sampledLattice(
  bounds: Bounds,
  frame: LatticeFrame,
  covers: (x: number, y: number) => boolean,
  periodicColumns: number | null,
  numerical?: NumericalAllocator
) {
  const rows = latticeRows(frame, numerical);
  const membership = allocateNumerical(
    { type: "uint8", length: rows.slots, lifetime: "process", name: "lattice:membership" },
    numerical
  );
  const width = bounds[2] - bounds[0],
    height = bounds[3] - bounds[1],
    origin = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
  let contentCount = 0,
    count = 0;
  forEachLatticeCell(rows, frame, (_, slot, x, y) => {
    const content =
      Math.abs(x) <= width / 2 && Math.abs(y) <= height / 2 && covers(x + origin[0], y + origin[1]);
    membership[slot] = content ? 1 : 2;
    contentCount += Number(content);
    count++;
  });
  if (!contentCount) {
    if (numerical)
      for (const vector of [rows.starts, rows.low, rows.high, membership])
        numerical.release(vector);
    return null;
  }
  const vector = (type: "int32" | "uint8", length: number, name: string) =>
    allocateNumerical({ type, length, lifetime: "run", name }, numerical);
  const u = vector("int32", count, "lattice:u"),
    v = vector("int32", count, "lattice:v"),
    inverted = vector("uint8", count, "lattice:orientation"),
    indexes = vector("int32", rows.slots, "lattice:index").fill(-1);
  let index = 0;
  for (const kind of [1, 2])
    forEachLatticeCell(rows, frame, (p, slot) => {
      if (membership[slot] !== kind) return;
      u[index] = p.u;
      v[index] = p.v;
      inverted[index] = Number(p.inverted);
      indexes[slot] = index++;
    });
  if (numerical) numerical.release(membership);
  return {
    coords: new LatticeCoordinates(u, v, inverted).view,
    indexes: new LatticeIndex(rows, indexes, frame, periodicColumns),
    contentCount,
    count,
  };
}
