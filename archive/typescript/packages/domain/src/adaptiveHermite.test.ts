import { expect, it } from "vitest";
import {
  prepareAdaptiveCell,
  preparedAdaptivePolynomial,
  evaluateAdaptiveCell,
  evaluatePreparedAdaptiveCell,
} from "./adaptiveHermite";

it("prepares the same continuous patch with its measured center correction and bounds", () => {
  const height = (u: number, v: number) => 10 + 2 * u + 3 * v + u * v;
  const coefficients = Float64Array.from(
    [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ].flatMap(([u, v]) => [height(u, v), 2 + v, 3 + u, 1])
  );
  for (const correction of [-8, 0, 8]) {
    const center = height(0.5, 0.5) + correction,
      cell = prepareAdaptiveCell(coefficients, center);
    expect(evaluatePreparedAdaptiveCell(cell, 0.5, 0.5)).toBeCloseTo(center, 10);
    for (const u of [0, 0.13, 0.5, 0.91, 1])
      for (const v of [0, 0.21, 0.5, 0.87, 1]) {
        const expected = height(u, v) + correction * 256 * (u * (1 - u) * v * (1 - v)) ** 2;
        expect(preparedAdaptivePolynomial(cell, u, v)).toBeCloseTo(expected, 10);
        const bounded = Math.max(Math.min(center, 10), Math.min(Math.max(center, 16), expected));
        expect(evaluatePreparedAdaptiveCell(cell, u, v)).toBeCloseTo(bounded, 10);
        expect(evaluateAdaptiveCell(coefficients, center, u, v)).toBeCloseTo(bounded, 10);
      }
  }
});
