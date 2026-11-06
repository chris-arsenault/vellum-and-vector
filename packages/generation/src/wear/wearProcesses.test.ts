import { expect, it } from "vitest";
import { physicalProfile } from "../canonry/profile";
import { wearProfileAt } from "./wearProcesses";

it("reads each process's settings at the map's scale", () => {
  const world = physicalProfile,
    region = wearProfileAt(world, { scale: 0.1, passes: 4 });
  // A channel's catchment scales with area.
  // A finer map also resolves channels from less, since its cells see the channel itself.
  expect(region.FluvialChannelArea).toBeCloseTo((world.FluvialChannelArea * 0.01) / 3);
  expect(region.FluvialEquilibriumGradient).toBeCloseTo(world.FluvialEquilibriumGradient * 0.53);
  expect(region.DissolvedPerPass).toBeCloseTo(world.DissolvedPerPass / 4);
  // The World reads its own parameters unchanged.
  expect(wearProfileAt(world, { scale: 1, passes: 1 })).toEqual(world);
});
