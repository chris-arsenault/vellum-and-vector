import { expect, it } from "vitest";
import { mouthKeeps } from "./fluvial";

it("keeps a river's load at a sheltered, still mouth and loses it at an exposed one", () => {
  expect(mouthKeeps(0, 0)).toBe(1);
  expect(mouthKeeps(1000, 0)).toBe(0);
  expect(mouthKeeps(0, 1000)).toBe(0);
  expect(mouthKeeps(500, 500)).toBeCloseTo(0.25, 12);
  expect(mouthKeeps(200, 0)).toBeGreaterThan(mouthKeeps(700, 0));
});

it("keeps a share between nothing and everything whatever the sea reports", () => {
  expect(mouthKeeps(-50, 0)).toBe(1);
  expect(mouthKeeps(5000, 5000)).toBe(0);
});
