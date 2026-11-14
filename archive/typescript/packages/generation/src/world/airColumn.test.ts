import { expect, it } from "vitest";
import { columnRainfall } from "./airColumn";

it("lets local uplift deliver rain inside a subsiding dry belt", () => {
  const background = columnRainfall(0.8, 0.08, 100, 0);
  const windward = columnRainfall(0.8, 0.08, 100, 200);
  expect(windward - background).toBeCloseTo(160);
  // A storm that has condensed the remaining column still delivers its rain.
  expect(columnRainfall(0.8, 0.08, 0, 200)).toBeCloseTo(160);
});

it("retains the latitude contrast for air without local uplift", () => {
  expect(columnRainfall(0.8, 0.08, 100, 0)).toBeLessThan(columnRainfall(0.8, 1, 100, 0));
  expect(columnRainfall(0.8, 1, 0, 0)).toBe(0);
});
