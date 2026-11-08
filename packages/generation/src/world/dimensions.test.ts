import { expect, it } from "vitest";
import { MapScale } from "@atlas/domain";
import { channelDimensions, depthRateToDischarge, secondsPerYear } from "./dimensions";
import { createField } from "./field";
import { createWorldMesh } from "./worldMesh";

it("resolves channel dimensions from relative discharge and keeps material response", () => {
  const full = MapScale.reference(),
    half = new MapScale(2_000_000, 1_500_000, 10_000),
    channel = channelDimensions(100, 0.001, 1, full),
    smaller = channelDimensions(12.5, 0.001, 1, half),
    resistant = channelDimensions(100, 0.001, 2, full);
  expect(channel.width).toBeCloseTo(45);
  expect(smaller.width).toBeCloseTo(channel.width / 2);
  expect(smaller.depth).toBeCloseTo(channel.depth / 2);
  expect(resistant.width).toBeLessThan(channel.width);
  expect(resistant.depth).toBeGreaterThan(channel.depth);
  expect(depthRateToDischarge(1000, secondsPerYear)).toBeCloseTo(1);
});

it("retains scaled water depths below one millimetre through storage and discharge conversion", () => {
  const map = createField(createWorldMesh([0, 0, 1000, 750], 16, 0));
  const depth = MapScale.inUnits(map.scale.length(1e-8), "mm");
  expect(depth).toBeGreaterThan(0);
  expect(depth).toBeLessThan(1);
  for (const name of ["Rainfall", "Snowfall", "Runoff", "GlacialMeltwater"] as const) {
    map[name].set(0, depth);
    expect(map[name].get(0)).toBeCloseTo(depth);
    expect(depthRateToDischarge(map[name].get(0), secondsPerYear)).toBeCloseTo(
      MapScale.metres(depth, "mm")
    );
  }
});
