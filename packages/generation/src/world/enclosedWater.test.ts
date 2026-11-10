import { expect, it } from "vitest";
import { enclosedWaterDepth } from "./ocean";

it("connectivity loss preserves finite previous water without filling a new basin", () => {
  expect(enclosedWaterDepth(30, 100, 70, 100, false)).toBe(30);
  expect(enclosedWaterDepth(30, 100, 40, 100, false)).toBe(30);
  expect(enclosedWaterDepth(0, 100, 40, 100, false)).toBe(0);
});

it("uplift limits retained water, while reconnection and exposed shores leave no enclosed supply", () => {
  expect(enclosedWaterDepth(30, 100, 90, 100, false)).toBe(10);
  expect(enclosedWaterDepth(30, 100, 70, 100, true)).toBe(0);
  expect(enclosedWaterDepth(30, 100, 90, 80, false)).toBe(0);
  expect(enclosedWaterDepth(30, 100, 110, 120, false)).toBe(0);
});

it("later ocean refreshes preserve enclosed water above the sea until the lake owner adjusts it", () => {
  expect(enclosedWaterDepth(10, 100, 90, 80, false, false)).toBe(10);
  expect(enclosedWaterDepth(10, 100, 90, 110, true, false)).toBe(0);
});
