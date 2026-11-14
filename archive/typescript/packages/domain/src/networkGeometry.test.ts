import { expect, it } from "vitest";
import { splitDirectedLine } from "./networkGeometry";
import { Spatial } from "./spatial";

it("retains a directed closed path and nodes every visit to a self-intersection", () => {
  const ring = {
    type: "LineString" as const,
    coordinates: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
  };
  expect(splitDirectedLine(ring, [], 1e-6)).toEqual([ring]);
  const crossing = {
    type: "LineString" as const,
    coordinates: [
      [0, 0],
      [10, 10],
      [0, 10],
      [10, 0],
    ],
  };
  const pieces = splitDirectedLine(crossing, [{ x: 5, y: 5, z: 0 }], 1e-6);
  expect(pieces).toHaveLength(3);
  expect(pieces[1]).toEqual({
    type: "LineString",
    coordinates: [
      [5, 5],
      [10, 10],
      [0, 10],
      [5, 5],
    ],
  });
});
it("preserves explicit zero elevations through spatial canonicalization and directed splitting", () => {
  const path = {
    type: "LineString" as const,
    coordinates: [
      [0, 0, 0],
      [10, 0, 10],
    ],
  };
  expect(new Spatial().canonical(path)).toEqual(path);
  expect(splitDirectedLine(path, [{ x: 5, y: 0, z: 5 }], 1e-6)).toEqual([
    {
      type: "LineString",
      coordinates: [
        [0, 0, 0],
        [5, 0, 5],
      ],
    },
    {
      type: "LineString",
      coordinates: [
        [5, 0, 5],
        [10, 0, 10],
      ],
    },
  ]);
});
