import { expect, it } from "vitest";
import { atlasPhysicalProfile } from "./atlasProfile";
import { beltRainout } from "./belts";

it("rains out most at the equatorial convergence and least under the subtropical highs", () => {
  const p = atlasPhysicalProfile(),
    at = (latitude: number) => beltRainout(p, latitude);
  expect(at(0)).toBeGreaterThan(at(50));
  expect(at(50)).toBeGreaterThan(1);
  expect(at(30)).toBeLessThan(0.5);
  expect(at(85)).toBeLessThan(1);
  expect(at(-30)).toBe(at(30));
});
