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

it("gives each line of a course drawn in several its own run of the per-vertex values", () => {
  const lines = [
      [
        [0, 0],
        [10, 0],
      ],
      [
        [50, 0],
        [60, 0],
        [70, 0],
      ],
    ],
    feature = {
      geometry: { type: "MultiLineString", coordinates: lines },
      attributes: { junctions: [], discharges: [1, 2, 3, 4, 5] },
    } as unknown as AtlasFeature,
    parts = networkParts(feature, reference);
  expect(parts.map((part) => part.coordinates)).toEqual(lines);
  expect(parts.map((part) => part.attributes.discharges)).toEqual([
    [1, 2],
    [3, 4, 5],
  ]);
  expect(parts.map((part) => part.attributes.discharge)).toEqual([1, 3]);
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
