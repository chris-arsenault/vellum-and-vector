import { expect, it } from "vitest";
import { atlasPhysicalProfile } from "./atlasProfile";

it("floods the share of the world that is not continental crust", () => {
  expect(atlasPhysicalProfile().QualityTargets.OceanCoverage.target).toBeCloseTo(0.52, 6);
  expect(atlasPhysicalProfile({ landFraction: 0.25 }).QualityTargets.OceanCoverage.target).toBe(
    0.75
  );
  expect(
    atlasPhysicalProfile({ landFraction: 0.7 }).QualityTargets.OceanCoverage.target
  ).toBeCloseTo(0.3, 6);
});
