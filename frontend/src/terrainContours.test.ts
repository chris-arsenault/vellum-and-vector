import { expect, it } from "vitest";
import { contourScale } from "./terrainContours";

it("retains the requested minimum and uses nested datum-anchored intervals", () => {
  expect(contourScale(100, 1)).toEqual({ contourStep: 100, contourMix: 0 });
  expect(contourScale(100, 400)).toEqual({ contourStep: 100, contourMix: 0 });
  for (const minimum of [0.01, 10, 100, 350])
    for (const resolution of [1, 100, 1000, 100_000, 1e9]) {
      const { contourStep, contourMix } = contourScale(minimum, resolution);
      expect(contourStep).toBeGreaterThanOrEqual(minimum);
      expect(Math.log(contourStep / minimum) / Math.log(5)).toBeCloseTo(
        Math.round(Math.log(contourStep / minimum) / Math.log(5)),
        9
      );
      expect(contourMix).toBeGreaterThanOrEqual(0);
      expect(contourMix).toBeLessThan(1);
    }
});

it("crossfades into the same hierarchy on either side of a zoom transition", () => {
  for (const transition of [2000, 10_000, 50_000]) {
    const before = contourScale(100, transition * (1 - 1e-8));
    const after = contourScale(100, transition * (1 + 1e-8));
    expect(before.contourStep * 5).toBe(after.contourStep);
    expect(before.contourMix).toBeGreaterThan(0.999999);
    expect(after.contourMix).toBeLessThan(0.000001);
  }
});
