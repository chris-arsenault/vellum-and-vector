import { expect, it } from "vitest";
import type { LineString } from "geojson";
import { spatial, rectangle, point } from "./spatial";

it("partitions water with a zero-width section while preserving area and holes", () => {
  const area = spatial.difference(rectangle([0, 0, 10, 10]), rectangle([2, 2, 4, 4]))!;
  const section: LineString = {
    type: "LineString",
    coordinates: [
      [5, 0],
      [5, 10],
    ],
  };
  const parts = spatial.partition(area, [section]);
  expect(parts).toHaveLength(2);
  expect(parts.reduce((sum, part) => sum + spatial.area(part), 0)).toBe(spatial.area(area));
  const upstream = parts.find((part) => spatial.covers(part, point({ x: 1, y: 5, z: 0 })))!;
  expect(spatial.covers(upstream, point({ x: 3, y: 3, z: 0 }))).toBe(false);
  expect(spatial.covers(upstream, point({ x: 8, y: 5, z: 0 }))).toBe(false);
  expect(spatial.covers(upstream, point({ x: 5, y: 5, z: 0 }))).toBe(true);
  expect(
    spatial.partition(area, [
      {
        type: "LineString",
        coordinates: [
          [5, 2],
          [5, 8],
        ],
      },
    ])
  ).toHaveLength(1);
});
