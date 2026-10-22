import { expect, it } from "vitest";
import {
  prepareSampleCoefficients,
  preparedSampleInterpolator,
  type SampleSupport,
} from "./smoothSamples";

const support: SampleSupport = {
  x: Float64Array.from({ length: 49 }, (_, i) => (i % 7) * 10),
  y: Float64Array.from({ length: 49 }, (_, i) => Math.floor(i / 7) * 10),
  origin: [130, -270],
  spacing: 10,
};
it("bounds the derivative through a cardinal node without an artificial singularity", () => {
  const values = Float64Array.from(
    support.x,
    (x, i) => Math.sin(x / 17) * Math.cos(support.y[i] / 13)
  );
  const read = preparedSampleInterpolator(
    support,
    values,
    prepareSampleCoefficients(support, values)
  );
  const box: [number, number, number, number] = [158, -242, 162, -238],
    bounds = read.enclose(box);
  expect(bounds.gradient.flat().every(Number.isFinite)).toBe(true);
  for (let row = 0; row <= 16; row++)
    for (let column = 0; column <= 16; column++) {
      const x = box[0] + column / 4,
        y = box[1] + row / 4,
        h = 1e-4;
      const derivatives = [
        (read(x + h, y) - read(x - h, y)) / (2 * h),
        (read(x, y + h) - read(x, y - h)) / (2 * h),
      ];
      derivatives.forEach((v, axis) => {
        expect(v).toBeGreaterThanOrEqual(bounds.gradient[axis][0] - 1e-8);
        expect(v).toBeLessThanOrEqual(bounds.gradient[axis][1] + 1e-8);
      });
    }
  const point = read.enclose([160, -240, 160, -240]);
  expect(point.gradient[0][0]).toBeCloseTo(read.coefficients.dx[24], 12);
  expect(point.gradient[1][1]).toBeCloseTo(read.coefficients.dy[24], 12);
});
it("proves a local constant patch despite different distant field values", () => {
  const values = new Float64Array(49).fill(7);
  values[48] = 20;
  const read = preparedSampleInterpolator(
    support,
    values,
    prepareSampleCoefficients(support, values)
  );
  expect(read.enclose([130, -270, 140, -260]).gradient).toEqual([
    [0, 0],
    [0, 0],
  ]);
});
