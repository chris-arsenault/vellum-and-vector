import { allocateNumerical, type NumericalAllocator, type NumericalVector } from "@atlas/domain";
import type { TriangleCoord } from "./mesh";

export interface LatticeFrame {
  width: number;
  height: number;
  spacing: number;
  spacingY: number;
  offset: [number, number];
}
export interface LatticeRows {
  minimumU: number;
  starts: NumericalVector;
  low: NumericalVector;
  high: NumericalVector;
  slots: number;
}
export function latticePosition(p: TriangleCoord, frame: LatticeFrame): [number, number] {
  return [
    (1.5 * (p.u + p.v) + (p.inverted ? 2 : 1)) * frame.spacing + frame.offset[0],
    (Math.sqrt(3) * (-p.u + p.v) * frame.spacingY) / 2 + frame.offset[1],
  ];
}
function coordinateLimits(frame: LatticeFrame) {
  const x0 = (-frame.width / 2 - frame.offset[0]) / frame.spacing,
    x1 = (frame.width / 2 - frame.offset[0]) / frame.spacing;
  const scaleY = (Math.sqrt(3) * frame.spacingY) / 2;
  return {
    sumLow: [(x0 - 1) / 1.5, (x0 - 2) / 1.5],
    sumHigh: [(x1 - 1) / 1.5, (x1 - 2) / 1.5],
    differenceLow: (-frame.height / 2 - frame.offset[1]) / scaleY,
    differenceHigh: (frame.height / 2 - frame.offset[1]) / scaleY,
  };
}
/** Enumerate the rectangle's lattice rows, avoiding a square candidate scan on long worlds. */
export function latticeRows(frame: LatticeFrame, numerical?: NumericalAllocator): LatticeRows {
  const limits = coordinateLimits(frame);
  const minimumU = Math.floor((Math.min(...limits.sumLow) - limits.differenceHigh) / 2) - 1;
  const maximumU = Math.ceil((Math.max(...limits.sumHigh) - limits.differenceLow) / 2) + 1;
  const length = maximumU - minimumU + 1;
  const vector = (type: "int32" | "float64", size: number, name: string) =>
    allocateNumerical({ type, length: size, lifetime: "run", name }, numerical);
  const starts = vector("float64", length + 1, "lattice:rows"),
    low = vector("int32", length, "lattice:low"),
    high = vector("int32", length, "lattice:high");
  let slots = 0;
  for (let row = 0; row < length; row++) {
    const u = row + minimumU;
    const lows = limits.sumLow.map((sum) => Math.max(sum - u, limits.differenceLow + u));
    const highs = limits.sumHigh.map((sum) => Math.min(sum - u, limits.differenceHigh + u));
    // Include boundary candidates before the exact centroid predicate; rounding cannot omit a cell.
    low[row] = Math.ceil(Math.min(...lows)) - 1;
    high[row] = Math.floor(Math.max(...highs)) + 1;
    starts[row] = slots;
    slots += Math.max(0, high[row] - low[row] + 1) * 2;
  }
  starts[length] = slots;
  return { minimumU, starts, low, high, slots };
}
export function forEachLatticeCell(
  rows: LatticeRows,
  frame: LatticeFrame,
  visit: (p: TriangleCoord, slot: number, x: number, y: number) => void
) {
  for (let row = 0; row < rows.low.length; row++)
    for (let v = rows.low[row]; v <= rows.high[row]; v++)
      for (const inverted of [false, true]) {
        const p = { u: row + rows.minimumU, v, inverted },
          [x, y] = latticePosition(p, frame);
        if (Math.abs(x) <= frame.width / 2 && Math.abs(y) <= frame.height / 2)
          visit(p, rows.starts[row] + (v - rows.low[row]) * 2 + Number(inverted), x, y);
      }
}
export function latticeSlot(rows: LatticeRows, u: number, v: number, inverted: boolean) {
  const row = u - rows.minimumU;
  if (row < 0 || row >= rows.low.length || v < rows.low[row] || v > rows.high[row]) return -1;
  return rows.starts[row] + (v - rows.low[row]) * 2 + Number(inverted);
}
