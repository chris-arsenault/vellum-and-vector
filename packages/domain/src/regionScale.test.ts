import { expect, it } from "vitest";
import { minimumRegionWidthMetres, usefulRegionSize } from "./regionViews";
import { rectangle } from "./spatial";

it("judges selection width in the owning map frame", () => {
  const world = rectangle([0, 0, 4_000_000, 3_000_000]),
    region = rectangle([0, 0, 4000, 3000]);
  expect(minimumRegionWidthMetres(world)).toBe(100);
  expect(minimumRegionWidthMetres(region)).toBeCloseTo(0.1);
  expect(usefulRegionSize(rectangle([0, 0, 10, 1000]), world)).toBe(false);
  expect(usefulRegionSize(rectangle([0, 0, 10, 1000]), region)).toBe(true);
});
