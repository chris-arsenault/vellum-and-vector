import { expect, it } from "vitest";
import { physicalProfile } from "../canonry/profile";
import { regionalErosionProfile } from "./erosion";

it("reads the world's erosion parameters at the map's scale", () => {
  const world = physicalProfile,
    region = regionalErosionProfile(world, 0.1, 2000);
  // A channel's catchment scales with area; a cell step holds a hillslope's slope over its length.
  expect(region.FluvialChannelArea).toBeCloseTo(world.FluvialChannelArea * 0.01);
  expect(region.MassWastingStableGradient).toBeCloseTo(world.MassWastingStableGradient * 0.5);
  // The World reads its own parameters unchanged.
  expect(regionalErosionProfile(world, 1, 30_000)).toMatchObject({
    FluvialChannelArea: world.FluvialChannelArea,
  });
});
