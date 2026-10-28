import { expect, it } from "vitest";
import { rectangle } from "@atlas/domain";
import { createWorldSnapshot } from "./worldCreation";
import { sceneWindows, displayTolerance, mergeDisplayFragments } from "./sceneWindows";

it("reads both sides of the cylindrical seam once, including translated and whole-world views", () => {
  const { world } = createWorldSnapshot({
    name: "Cylinder",
    seed: 7,
    width: 1000,
    height: 500,
    boundaryMode: "cylinder",
  });
  expect(sceneWindows(world, [900, 10, 1100, 90])).toEqual([
    [900, 10, 1000, 90],
    [0, 10, 100, 90],
  ]);
  expect(sceneWindows(world, [-100, 10, 100, 90])).toEqual([
    [900, 10, 1000, 90],
    [0, 10, 100, 90],
  ]);
  expect(sceneWindows(world, [-100, 0, 1900, 500])).toEqual([[0, 0, 1000, 500]]);
  expect(sceneWindows(world, [2100, 20, 2200, 30])).toEqual([[100, 20, 200, 30]]);
  expect(displayTolerance(40)).toBe(16);
  expect(displayTolerance(0)).toBe(0);
});

it("keeps both fragments of a feature read from two seam windows", () => {
  const west = rectangle([900, 0, 1000, 50]),
    east = rectangle([0, 0, 100, 50]);
  const merged = mergeDisplayFragments(west, east);
  if (merged.type !== "MultiPolygon" || west.type !== "Polygon" || east.type !== "Polygon")
    throw new Error("Expected polygons merged into a multipolygon.");
  expect(merged.coordinates).toEqual([west.coordinates, east.coordinates]);
});

it("groups mixed display fragments by dimension", () => {
  const merged = mergeDisplayFragments(
    {
      type: "LineString",
      coordinates: [
        [0, 0],
        [1, 1],
      ],
    },
    {
      type: "GeometryCollection",
      geometries: [rectangle([0, 0, 1, 1]), { type: "Point", coordinates: [2, 2] }],
    }
  );
  expect(merged.type).toBe("GeometryCollection");
  if (merged.type !== "GeometryCollection") throw new Error("Expected a collection.");
  expect(merged.geometries.map((g) => g.type)).toEqual([
    "MultiPolygon",
    "MultiLineString",
    "MultiPoint",
  ]);
});
