import { expect, it } from "vitest";
import { levelling } from "./creep";

/** One working of cover moving at its fastest between a hollow and the cells around it. */
function fill(hollow: number, around: number[], faces: number) {
  const moved = around.map((height) => levelling(height - hollow, 1, faces, faces));
  return {
    hollow: hollow + moved.reduce((sum, volume) => sum + volume, 0),
    around: around.map((height, n) => height - moved[n]),
  };
}

it("fills a hollow from all sides at once without raising it above the ground around it", () => {
  // A cell 100 below its three neighbours, each of which sends cover only into it.
  const after = fill(0, [100, 100, 100], 3);
  expect(after.hollow).toBeLessThanOrEqual(Math.min(...after.around));
  // Moving at its fastest it levels the four cells in one working.
  expect(after.hollow).toBeCloseTo(75, 9);
  expect(after.around).toEqual([75, 75, 75]);
});

it("never turns a hollow into a peak, however uneven the ground around it", () => {
  for (const around of [
    [10, 400, 90],
    [1, 2, 300],
    [250, 250, 5],
  ]) {
    const after = fill(0, around, 3);
    expect(after.hollow).toBeLessThanOrEqual(Math.max(...after.around));
  }
});

it("moves nothing uphill or across level ground", () => {
  expect(levelling(0, 1, 3, 3)).toBe(0);
  expect(levelling(-5, 1, 3, 3)).toBe(0);
});
