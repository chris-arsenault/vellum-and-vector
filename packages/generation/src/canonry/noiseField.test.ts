import { expect, it } from "vitest";
import { unitNoiseField, fractalNoiseField } from "./noiseField";
import { unitNoise, fractalNoise } from "./noise";
it("bounds the existing causal noise and its derivatives across lattice faces", () => {
  const field = unitNoiseField([17, -23], 42, 100);
  for (const box of [
    [10, 20, 37, 53],
    [-150, -80, 160, 170],
    [117, 77, 117, 77],
  ] as [number, number, number, number][]) {
    const e = field.enclose!(box);
    for (let i = 0; i <= 10; i++)
      for (let j = 0; j <= 10; j++) {
        const x = box[0] + ((box[2] - box[0]) * i) / 10,
          y = box[1] + ((box[3] - box[1]) * j) / 10;
        const v = field(x, y);
        expect(v).toBe(unitNoise(x - 17, y + 23, 42, 100, 1));
        expect(v).toBeGreaterThanOrEqual(e.range[0] - 1e-14);
        expect(v).toBeLessThanOrEqual(e.range[1] + 1e-14);
        for (const axis of [0, 1]) {
          const epsilon = 1e-4;
          const d =
            axis === 0
              ? (field(x + epsilon, y) - field(x - epsilon, y)) / (2 * epsilon)
              : (field(x, y + epsilon) - field(x, y - epsilon)) / (2 * epsilon);
          expect(d).toBeGreaterThanOrEqual(e.gradient[axis][0] - 1e-8);
          expect(d).toBeLessThanOrEqual(e.gradient[axis][1] + 1e-8);
        }
      }
  }
});
it("encloses rotated tectonic octaves at an offset origin", () => {
  const field = fractalNoiseField([173, -231], 42, 100, 3);
  for (const box of [
    [10, 20, 37, 53],
    [-150, -80, 160, 170],
    [117, 77, 117, 77],
  ] as [number, number, number, number][]) {
    const e = field.enclose!(box);
    for (let i = 0; i <= 10; i++)
      for (let j = 0; j <= 10; j++) {
        const x = box[0] + ((box[2] - box[0]) * i) / 10,
          y = box[1] + ((box[3] - box[1]) * j) / 10;
        expect(field(x, y)).toBe(fractalNoise(x - 173, y + 231, 42, 100, 3));
        expect(field(x, y)).toBeGreaterThanOrEqual(e.range[0] - 1e-14);
        expect(field(x, y)).toBeLessThanOrEqual(e.range[1] + 1e-14);
        const h = 1e-4,
          gradient = [
            (field(x + h, y) - field(x - h, y)) / (2 * h),
            (field(x, y + h) - field(x, y - h)) / (2 * h),
          ];
        gradient.forEach((d, axis) => {
          expect(d).toBeGreaterThanOrEqual(e.gradient[axis][0] - 1e-8);
          expect(d).toBeLessThanOrEqual(e.gradient[axis][1] + 1e-8);
        });
      }
  }
});
