import { expect, it } from "vitest";
import { prepareSampleCoefficients, preparedSampleInterpolator, type SampleSupport } from "./smoothSamples";
import { sampleCombination } from "./sampleCombination";

const support: SampleSupport = {
  x: Float64Array.from({ length: 25 }, (_, i) => i % 5),
  y: Float64Array.from({ length: 25 }, (_, i) => Math.floor(i / 5)),
  origin: [0, 0], spacing: 1,
};

it("retains cancellation in the shared prepared basis without another coefficient fit", () => {
  const first = Float64Array.from(support.x, (x, i) => 10000 * Math.exp(-((x - 2) ** 2 + (support.y[i] - 2) ** 2))),
    second = Float64Array.from(first, (v) => 2 * v);
  const a = prepareSampleCoefficients(support, first), b = prepareSampleCoefficients(support, second),
    before = structuredClone({ first, second, a, b });
  const combined = sampleCombination(support, [
    { values: first, coefficients: a, scale: 2 }, { values: second, coefficients: b, scale: -1 },
  ]);
  expect(combined.enclose([0, 0, 4, 4]).range).toEqual([0, 0]);
  for (let x = 0; x <= 4; x += 0.13) expect(combined(x, 2.13)).toBe(0);
  expect({ first, second, a, b }).toEqual(before);
});

it("bounds and evaluates linear combinations of the already limited source jets", () => {
  const values = [Float64Array.from(support.x, (x, i) => x * x + support.y[i]), Float64Array.from(support.x, (x, i) => Math.sin(x + support.y[i]))];
  const terms = values.map((value, i) => ({ values: value, coefficients: prepareSampleCoefficients(support, value), scale: [2, -3][i] }));
  const reads = terms.map((t) => preparedSampleInterpolator(support, t.values, t.coefficients)),
    combined = sampleCombination(support, terms), bounds = combined.enclose([1, 1, 2, 2]).range;
  for (let x = 1; x <= 2; x += 0.11)
    for (let y = 1; y <= 2; y += 0.11) {
      const actual = combined(x, y);
      expect(actual).toBeCloseTo(2 * reads[0](x, y) - 3 * reads[1](x, y), 11);
      expect(actual).toBeGreaterThanOrEqual(bounds[0]);
      expect(actual).toBeLessThanOrEqual(bounds[1]);
    }
});
