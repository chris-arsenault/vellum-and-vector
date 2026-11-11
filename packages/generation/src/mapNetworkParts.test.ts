import { expect, it } from "vitest";
import type { AtlasFeature, World } from "@atlas/domain";
import { networkParts } from "./mapNetworkParts";

const reference = { precision: 1 } as World["reference"];
const course = (coordinates: number[][], junctions: number[][]) =>
  ({
    geometry: { type: "LineString", coordinates },
    attributes: { junctions, discharges: coordinates.map((_, index) => index) },
  }) as unknown as AtlasFeature;

it("cuts a course at its interior junctions and carries each stretch's own profile", () => {
  const parts = networkParts(
    course(
      [
        [0, 0],
        [10, 0],
        [20, 0],
      ],
      [[10, 0]]
    ),
    reference
  );
  expect(parts.map((part) => part.coordinates)).toEqual([
    [
      [0, 0],
      [10, 0],
    ],
    [
      [10, 0],
      [20, 0],
    ],
  ]);
  expect(parts.map((part) => part.attributes.discharges)).toEqual([
    [0, 1],
    [1, 2],
  ]);
});

it("leaves no stretch between two junctions closer than the map stores apart", () => {
  const parts = networkParts(
    course(
      [
        [0, 0],
        [10, 0],
        [10.2, 0],
        [20, 0],
      ],
      [
        [10, 0],
        [10.2, 0],
      ]
    ),
    reference
  );
  expect(parts.map((part) => part.coordinates)).toEqual([
    [
      [0, 0],
      [10, 0],
    ],
    [
      [10.2, 0],
      [20, 0],
    ],
  ]);
});
