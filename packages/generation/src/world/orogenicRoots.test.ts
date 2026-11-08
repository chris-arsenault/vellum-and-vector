import { expect, it } from "vitest";
import { mobileCrust } from "./orogenicRoots";

it("includes surface rock in the load driving deep crustal flow", () => {
  expect(mobileCrust(4000, 0, 1, 0, 2000, 1)).toBe(0);
  expect(mobileCrust(4000, 7000, 1, 0, 2000, 1)).toBeCloseTo(1000);
  expect(mobileCrust(4000, -7000, 1, 0, 2000, 1)).toBe(0);
});

it("lets compression support excess load and permits flow when that support ends", () => {
  expect(mobileCrust(6000, 0, 1, 3000, 2000, 1)).toBe(0);
  expect(mobileCrust(6000, 0, 1, 0, 2000, 1)).toBe(1000);
});

it("has no relaxation without exposure and cannot remove the basal column", () => {
  expect(mobileCrust(6000, 7000, 1, 0, 2000, 0)).toBe(0);
  expect(mobileCrust(900, 100_000, 1, 0, 2000, 1)).toBe(100);
});
