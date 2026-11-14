import { expect, it } from "vitest";
import { MapScale } from "@atlas/domain";
import { atlasPhysicalProfile } from "./atlasProfile";

it("sets exposed land independently of the continental crust allocation", () => {
  expect(
    atlasPhysicalProfile({}, {}, MapScale.reference()).QualityTargets.OceanCoverage.target
  ).toBeCloseTo(0.62, 6);
  expect(
    atlasPhysicalProfile({ landFraction: 0.25 }, {}, MapScale.reference()).QualityTargets
      .OceanCoverage.target
  ).toBe(0.75);
  expect(
    atlasPhysicalProfile({ landFraction: 0.7 }, {}, MapScale.reference()).QualityTargets
      .OceanCoverage.target
  ).toBeCloseTo(0.3, 6);
  const profile = atlasPhysicalProfile(
    { landFraction: 0.25, continentalCrustFraction: 0.6 },
    {},
    MapScale.reference()
  );
  expect(profile.ContinentalCrustFraction).toBe(0.6);
  expect(profile.QualityTargets.OceanCoverage.target).toBe(0.75);
});
