import { expect, it } from "vitest";
import { createGrid, putChannel } from "./grids";
import { fieldExtrema } from "./fieldExtrema";
import type { SpatialScope } from "./schemas";

const scope: SpatialScope = {
  worldId: "world",
  areaId: "area",
  spaceId: "world",
  crsId: "planar",
  revision: 1,
  time: "present",
  resolution: null,
  footprint: {
    type: "Polygon",
    coordinates: [
      [
        [0, 50],
        [50, 0],
        [100, 50],
        [50, 100],
        [0, 50],
      ],
    ],
  },
};
it("checks bilinear support inside clipped footprints with no active grid vertices", () => {
  const grid = createGrid("field", scope, 2, 2);
  putChannel(grid, "elevation", "metre", new Float64Array(4).fill(1000));
  expect([...grid.active]).toEqual([0, 0, 0, 0]);
  expect(fieldExtrema(grid, "elevation", scope.footprint)).toEqual([1000, 1000]);
});
it("includes quadratic extrema along diagonal constraint edges", () => {
  const grid = createGrid(
    "field",
    {
      ...scope,
      footprint: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [100, 0],
            [100, 100],
            [0, 100],
            [0, 0],
          ],
        ],
      },
    },
    2,
    2
  );
  putChannel(grid, "elevation", "metre", Float64Array.from([0, 1, 1, 0]));
  expect(
    fieldExtrema(grid, "elevation", {
      type: "LineString",
      coordinates: [
        [0, 0],
        [100, 100],
      ],
    })
  ).toEqual([0, 0.5]);
});
