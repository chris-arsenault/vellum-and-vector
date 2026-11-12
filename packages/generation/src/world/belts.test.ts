import { expect, it } from "vitest";
import { MapScale } from "@atlas/domain";
import { atlasPhysicalProfile } from "./atlasProfile";
import { rainThroughYear } from "./belts";

const profile = atlasPhysicalProfile({}, {}, MapScale.reference()),
  year = (latitude: number, swing: number) =>
    Array.from(rainThroughYear(profile, latitude, swing, new Float64Array(12))),
  // Month 0 is the coldest and month 6 the warmest.
  cold = (shares: number[]) => shares[11] + shares[0] + shares[1],
  warm = (shares: number[]) => shares[5] + shares[6] + shares[7];

it("moves no rain out of the year: the months' shares make the whole", () => {
  for (const latitude of [-60, -38, -15, 0, 15, 38, 60])
    expect(year(latitude, 1).reduce((total, share) => total + share, 0)).toBeCloseTo(1, 12);
});

it("gives the margins of the tropics a wet summer and a dry winter", () => {
  const shares = year(15, 1);
  expect(warm(shares)).toBeGreaterThan(2 * cold(shares));
  // The other hemisphere has the same year, half a year apart in the calendar.
  expect(year(-15, 1)).toEqual(shares);
});

it("gives the coasts beyond the subtropical high a dry summer and winter storms", () => {
  const shares = year(38, 0.35);
  expect(cold(shares)).toBeGreaterThan(warm(shares));
});

it("gives the equator two wet seasons as the belt passes twice", () => {
  const shares = year(0, 1);
  expect(shares[3]).toBeGreaterThan(shares[0]);
  expect(shares[3]).toBeGreaterThan(shares[6]);
  expect(shares[9]).toBeCloseTo(shares[3], 12);
});

it("spreads the year evenly where the belts do not move", () => {
  for (const share of year(25, 0)) expect(share).toBeCloseTo(1 / 12, 12);
});
