import { expect, it } from "vitest";
import {
  prepareAdaptiveCell,
  preparedAdaptivePolynomial,
  preparedAdaptiveDerivative,
} from "./adaptiveHermite";
import { bernsteinPatchInterval } from "./bernsteinPatch";

it("keeps exact zero edges and their tangential derivatives free of sampling cancellation", () => {
  const coefficients = new Float64Array(16);
  coefficients[0] = coefficients[8] = 400;
  const cell = prepareAdaptiveCell(coefficients, 200);
  for (let v = 0; v <= 1; v += 0.03125) {
    expect(preparedAdaptivePolynomial(cell, 1, v)).toBe(0);
    expect(preparedAdaptiveDerivative(cell, 1, v, 1)).toBe(0);
  }
  expect(bernsteinPatchInterval(cell.bernstein, [1, 0.1, 1, 0.9])).toEqual([0, 0]);
  expect(bernsteinPatchInterval(cell.bernstein, [0, 0.1, 1, 0.9], 1)).toEqual([0, 0]);
});
it("bounds prepared polynomial values and derivatives within arbitrary subrectangles", () => {
  const coefficients = Float64Array.from({ length: 16 }, (_, i) => Math.sin(i * 1.7) * 100);
  const cell = prepareAdaptiveCell(coefficients, 73);
  const box: [number, number, number, number] = [0.17, 0.23, 0.71, 0.83];
  for (const axis of [undefined, 0, 1] as const) {
    const [low, high] = bernsteinPatchInterval(cell.bernstein, box, axis);
    for (let u = box[0]; u <= box[2]; u += 0.07)
      for (let v = box[1]; v <= box[3]; v += 0.09) {
        const value =
          axis === undefined
            ? preparedAdaptivePolynomial(cell, u, v)
            : preparedAdaptiveDerivative(cell, u, v, axis);
        expect(value).toBeGreaterThanOrEqual(low - 1e-10);
        expect(value).toBeLessThanOrEqual(high + 1e-10);
      }
  }
});
