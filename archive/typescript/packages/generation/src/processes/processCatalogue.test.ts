import { expect, it } from "vitest";
import { physicalProfile } from "../world/profile";
import { groundProcesses, profileForExecution } from "./processCatalogue";
import { MapScale } from "@atlas/domain";

it("assembles the profile from what each process says it owns", () => {
  for (const process of groundProcesses)
    expect(physicalProfile.values).toMatchObject(process.settings);
});
it("adjusts execution policy without applying a second geographic scale", () => {
  const world = MapScale.reference().resolve(physicalProfile),
    region = profileForExecution(world, { refined: true, passes: 4 });
  expect(region.FluvialChannelArea).toBeCloseTo(world.FluvialChannelArea / 3);
  expect(region.FluvialEquilibriumGradient).toBeCloseTo(world.FluvialEquilibriumGradient * 0.53);
  expect(region.DissolvedPerSpan).toBeCloseTo(world.DissolvedPerSpan / 4);
  // The World reads its own parameters unchanged.
  expect(profileForExecution(world, { refined: false, passes: 1 })).toEqual(world);
});
it("resolves vertical, area, flux and fractional dimensions before process execution", () => {
  const reference = MapScale.reference().resolve(physicalProfile),
    smaller = new MapScale(2_000_000, 1_500_000, 10_000).resolve(physicalProfile);
  expect(smaller.WeatheringShieldDepth).toBe(reference.WeatheringShieldDepth / 2);
  expect(smaller.FluvialChannelArea).toBe(reference.FluvialChannelArea / 4);
  expect(smaller.WorldRiverMinimumBasinDischarge).toBe(
    reference.WorldRiverMinimumBasinDischarge / 8
  );
  expect(smaller.IceYieldHeight).toBeCloseTo(reference.IceYieldHeight / Math.sqrt(2));
  expect(smaller.ElevationTemperatureLapse).toBe(reference.ElevationTemperatureLapse);
  // Measured section values are decoded, never resolved as new geographic controls.
  expect(MapScale.metres(MapScale.native(240), "native")).toBe(240);
});

it("declares precipitation in physical metres and encodes native millimetre fields once", () => {
  const scale = MapScale.reference(),
    resolved = scale.resolve(physicalProfile),
    half = new MapScale(2_000_000, 1_500_000, 10_000).resolve(physicalProfile),
    declaration = physicalProfile.values.ColumnSaturation;
  expect(declaration.fraction).toBe(4.125e-7);
  expect(resolved.ColumnSaturation).toBeCloseTo(1650);
  expect(MapScale.metres(resolved.ColumnSaturation, "mm")).toBeCloseTo(1.65);
  expect(scale.measureFraction(resolved.ColumnSaturation, 1, 1, "mm")).toBeCloseTo(
    declaration.fraction
  );
  expect(half.ColumnSaturation).toBeCloseTo(825);
  expect(resolved.LakeInfiltrationLoss).toBeCloseTo(140);
  expect(resolved.FluvialReferenceRunoff).toBeCloseTo(300);
  expect(resolved.FogDrip).toBeCloseTo(300);
});
