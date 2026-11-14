import { expect, it } from "vitest";
import type { MapSpace, SampleWindow } from "@atlas/map";
import { ownsSamplePoint, validateSampleWindow } from "./sampleWindow";

const space: MapSpace = {
  id: "surface",
  bounds: [0, 0, 10, 10],
  metresPerUnit: 1,
  precision: 1e-6,
  periodicWidth: null,
  parentSpaceId: null,
  frame: { origin: [0, 0, 0], rotation: 0, floor: null },
};
const window = (
  bounds: SampleWindow["bounds"],
  closedEast = false,
  closedNorth = false
): SampleWindow => ({ bounds, closedEast, closedNorth });

it("assigns shared edges east and north, including unequal cells and outer edges", () => {
  const cells = [
    window([0, 0, 5, 10], false, true),
    window([5, 0, 10, 5], true),
    window([5, 5, 10, 10], true, true),
  ];
  expect(cells.map((cell) => ownsSamplePoint(cell, space, [5, 5]))).toEqual([false, false, true]);
  expect(cells.map((cell) => ownsSamplePoint(cell, space, [10, 10]))).toEqual([false, false, true]);
  const east = window([5, 0, 10, 10], true, true);
  expect(ownsSamplePoint(east, space, [5, 5])).toBe(true);
  expect(ownsSamplePoint(window([0, 0, 5, 5]), space, [5, 5])).toBe(false);
});

it("uses the continuous sample chart across the world seam", () => {
  const periodic = { ...space, bounds: [0, 0, 100, 10] as MapSpace["bounds"], periodicWidth: 100 };
  const cell = window([97.5, 0, 102.5, 10], false, true);
  expect(ownsSamplePoint(cell, periodic, [1, 5])).toBe(true);
  expect(ownsSamplePoint(cell, periodic, [2.5, 5])).toBe(false);
  expect(ownsSamplePoint(cell, periodic, [97.5, 5])).toBe(true);
  expect(ownsSamplePoint(cell, periodic, [50, 5])).toBe(false);
});

it("uses declared map precision and rejects invalid ownership windows", () => {
  const cell = window([0, 0, 0.3, 1]);
  expect(ownsSamplePoint(cell, space, [0.1 + 0.2, 0.5])).toBe(false);
  expect(() => validateSampleWindow(window([0, 0, Infinity, 1]))).toThrow("ownership bounds");
  expect(() => validateSampleWindow(window([1, 0, 0, 1]))).toThrow("ownership bounds");
});
