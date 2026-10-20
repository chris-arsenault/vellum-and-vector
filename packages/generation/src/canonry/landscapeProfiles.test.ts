import { expect, it } from "vitest";
import { landscapeInterpolator } from "./landscapeProfiles";
import { rectangle } from "@atlas/domain";

it("blends a regional fit into its surroundings without creating a cliff at its support boundary", () => {
  const height = landscapeInterpolator(
    [
      {
        id: "regional-floor",
        points: [[0, 0]],
        widths: [10_000],
        values: { elevation: [100] },
        footprint: rectangle([-1000, -1000, 1000, 1000]),
        plateau: true,
        edgeBlend: 500,
        operation: "replace",
      },
    ],
    "elevation",
    () => 0
  );
  expect(height({ x: 0, y: 0, z: 0 })).toBe(100);
  expect(height({ x: 1001, y: 0, z: 0 })).toBe(0);
  expect(height({ x: 999, y: 0, z: 0 })).toBeLessThan(0.002);
  expect(height({ x: 750, y: 0, z: 0 })).toBeCloseTo(50);
});
