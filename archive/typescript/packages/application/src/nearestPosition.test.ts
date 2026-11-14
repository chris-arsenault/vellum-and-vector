import { expect, it } from "vitest";
import { rectangle } from "@atlas/domain";
import { nearestPosition } from "./nearestPosition";

it("attaches to the closest point of a line, polygon edge or collection, keeping elevation", () => {
  const line = {
    type: "LineString" as const,
    coordinates: [
      [0, 0],
      [10, 0],
      [10, 10],
    ],
  };
  expect(nearestPosition(line, { x: 4, y: 3, z: 7 })).toEqual({ x: 4, y: 0, z: 7 });
  expect(nearestPosition(line, { x: 14, y: 12, z: 0 })).toEqual({ x: 10, y: 10, z: 0 });
  expect(nearestPosition(rectangle([0, 0, 10, 10]), { x: 5, y: -4, z: 0 })).toEqual({
    x: 5,
    y: 0,
    z: 0,
  });
  expect(
    nearestPosition(
      { type: "GeometryCollection", geometries: [line, { type: "Point", coordinates: [3, 9] }] },
      { x: 3, y: 8, z: 0 }
    )
  ).toEqual({ x: 3, y: 9, z: 0 });
});
