import { expect, it } from "vitest";
import { halvedCellWidth } from "./atlasInitialState";

it("halves a map's width to the depth whose cells lie nearest the cell span", () => {
  // 300 spans across: 256 halvings give cells 1.17 spans wide, nearer than 512's 0.59.
  expect(halvedCellWidth(300, 1)).toBeCloseTo(300 / 256);
  // 400 spans across: 512 halvings give 0.78 spans, nearer than 256's 1.56.
  expect(halvedCellWidth(400, 1)).toBeCloseTo(400 / 512);
  // Every width keeps its cells within a factor of the square root of two of the span.
  for (let widest = 3; widest < 5000; widest *= 1.37) {
    const ratio = halvedCellWidth(widest, 1);
    expect(ratio).toBeGreaterThanOrEqual(Math.SQRT1_2 - 1e-12);
    expect(ratio).toBeLessThanOrEqual(Math.SQRT2 + 1e-12);
  }
  // A map narrower than one span is one cell.
  expect(halvedCellWidth(0.5, 1)).toBe(0.5);
});
