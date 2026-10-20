import { expect, it } from "vitest";
import { fieldInterpolator, putChannel, gridSchema } from "@atlas/domain";
import { macroFixture } from "./macroFixtures";
import { sampleFinishedLandscape } from "./macroSampling";

it("publishes a metre-wide channel as sampled values without widening the whole terrain mesh", () => {
  const state = macroFixture(),
    base = state.physical!.finishing!.baseSurface!;
  putChannel(base, "bedrock", "metre", base.channels.elevation.slice());
  const profiles = [
    {
      id: "narrow-channel",
      points: [
        [-80_000, 0],
        [0, 0],
        [80_000, 0],
      ] as [number, number][],
      widths: [2, 2, 2],
      values: { elevation: [80, 70, 60] },
      operation: "lower" as const,
    },
  ];
  const field = sampleFinishedLandscape(base, profiles),
    at = fieldInterpolator(field, "elevation");
  expect(field.active.length).toBeLessThan(100_000);
  expect(field.detail!.elements.length / 4).toBe(8);
  expect(at({ x: 0, y: 0, z: 0 })).toBeCloseTo(70, 0);
  expect(at({ x: 0, y: 4, z: 0 })).toBeGreaterThan(1000);
  expect(fieldInterpolator(field, "bedrock")({ x: 0, y: 0, z: 0 })).toBeCloseTo(70, 0);
  expect(gridSchema.safeParse(field).success).toBe(true);
  expect("landscape" in field).toBe(false);
  expect("landscapeBase" in field).toBe(false);
});
