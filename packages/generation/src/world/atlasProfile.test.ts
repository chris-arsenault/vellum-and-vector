import { expect, it } from "vitest";
import { MapScale } from "@atlas/domain";
import { atlasPhysicalProfile } from "./atlasProfile";

it("floods the share of the world that is not continental crust", () => {
  expect(
    atlasPhysicalProfile({}, {}, MapScale.reference()).QualityTargets.OceanCoverage.target
  ).toBeCloseTo(0.55, 6);
  expect(
    atlasPhysicalProfile({ landFraction: 0.25 }, {}, MapScale.reference()).QualityTargets
      .OceanCoverage.target
  ).toBe(0.75);
  expect(
    atlasPhysicalProfile({ landFraction: 0.7 }, {}, MapScale.reference()).QualityTargets
      .OceanCoverage.target
  ).toBeCloseTo(0.3, 6);
});
