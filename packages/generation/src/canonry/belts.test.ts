import { expect, it } from "vitest";
import { atlasPhysicalProfile } from "./atlasProfile";
import { beltRainout } from "./belts";
import { beltSpeed, circulation } from "./atmosphere";

it("rains out most at the equatorial convergence and least under the subtropical highs", () => {
  const p = atlasPhysicalProfile(),
    at = (latitude: number) => beltRainout(p, latitude);
  expect(at(0)).toBeGreaterThan(at(50));
  expect(at(50)).toBeGreaterThan(1);
  expect(at(30)).toBeLessThan(0.5);
  expect(at(85)).toBeLessThan(1);
  expect(at(-30)).toBe(at(30));
});

it("spreads the equatorial rain belt across the seasonal migration and dries the subtropics", () => {
  const p = atlasPhysicalProfile(),
    at = (latitude: number) => beltRainout(p, latitude);
  // The convergence still lifts rainout 10° from the equator, as the migrating belt does.
  expect(at(10)).toBeGreaterThan(1.5);
  expect(at(25)).toBeLessThan(0.6 * at(10));
  expect(at(30)).toBeLessThan(0.15);
});

it("mirrors the wind belts across the equator", () => {
  const p = atlasPhysicalProfile();
  for (const latitude of [5, 20, 35, 50, 65, 80]) {
    const [northEast, northNorth] = circulation(p, latitude),
      [southEast, southNorth] = circulation(p, -latitude);
    // Same zonal sense; meridional flow reflected, so both point equatorward or both poleward.
    expect(southEast).toBe(northEast);
    expect(southNorth).toBeCloseTo(-northNorth, 12);
    expect(beltSpeed(p, -latitude)).toBe(beltSpeed(p, latitude));
    expect(beltRainout(p, -latitude)).toBe(beltRainout(p, latitude));
  }
  // Trades blow from the east and toward the equator in both hemispheres.
  expect(circulation(p, 15)[0]).toBeLessThan(0);
  expect(circulation(p, 15)[1]).toBeLessThan(0);
  expect(circulation(p, -15)[1]).toBeGreaterThan(0);
});
