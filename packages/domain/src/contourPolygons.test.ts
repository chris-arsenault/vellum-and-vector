import { expect, it } from "vitest";
import { compactContour, polygonize } from "./contourPolygons";
import { spatial } from "./spatial";

it("preserves area while removing redundant stations on a long straight contour", () => {
  const ring: [number, number][] = Array.from({ length: 65_536 }, (_, i) => [0, i]);
  ring.push([100, 65_535], [100, 0], [0, 0]);
  expect(compactContour(ring)).toHaveLength(5);
  expect(spatial.area(polygonize([ring], () => 1, 0)!)).toBe(100 * 65_535);
});
it("retains reversals and small noncollinear turns", () => {
  const ring: [number, number][] = [
    [0, 0],
    [1, 0],
    [0, 0],
    [0, 1],
    [1e-8, 2],
    [0, 0],
  ];
  expect(compactContour(ring)).toEqual(ring);
  expect(
    polygonize(
      [
        [
          [0, 0],
          [1, 0],
          [2, 0],
          [0, 0],
        ],
      ],
      () => 1,
      0
    )
  ).toBeNull();
});
