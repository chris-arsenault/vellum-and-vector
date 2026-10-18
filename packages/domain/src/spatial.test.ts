import { expect, it } from "vitest";
import type { Geometry } from "geojson";
import { fromWorld, point, rectangle, spatial, toWorld, transformGeometry } from "./spatial";
import { createGrid, gridPosition, neighbors, putChannel, resample, sample } from "./grids";
import type { SpatialScope } from "./schemas";

const scope = (footprint: Geometry): SpatialScope => ({
  worldId: "world",
  areaId: "area",
  spaceId: "surface",
  footprint,
  crsId: "fictional",
  revision: 1,
  time: "present",
  resolution: 1,
});

it("preserves local units, floors and directed geometry through transforms", () => {
  const frame = {
    origin: { x: 1e7, y: -1e7, z: 120 },
    rotation: 73,
    metresPerUnit: 0.3048,
    floor: "upper",
  };
  const local = { x: 12, y: -4, z: 10 };
  const result = fromWorld(frame, toWorld(frame, local));
  expect(result.x).toBeCloseTo(local.x, 6);
  expect(result.y).toBeCloseTo(local.y, 6);
  expect(result.z).toBeCloseTo(local.z, 6);
  const line: Geometry = {
    type: "LineString",
    coordinates: [
      [8, 2, 4],
      [1, 2, 5],
    ],
  };
  const geometry = transformGeometry(transformGeometry(line, frame), frame, true);
  expect(geometry.type).toBe("LineString");
  if (geometry.type !== "LineString") throw new Error("Directed line type changed");
  const tolerance = spatial.precision * (1 + Math.SQRT2 / frame.metresPerUnit);
  geometry.coordinates.forEach((coordinate, i) =>
    coordinate.forEach((value, axis) =>
      expect(Math.abs(value - line.coordinates[i][axis])).toBeLessThanOrEqual(tolerance)
    )
  );
});

it("uses Cartesian area, exact holes and fixed boundary crossings", () => {
  const footprint: Geometry = {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      [
        [4, 4],
        [6, 4],
        [6, 6],
        [4, 6],
        [4, 4],
      ],
    ],
  };
  expect(spatial.area(footprint)).toBe(96);
  expect(spatial.covers(footprint, point({ x: 5, y: 5, z: 0 }))).toBe(false);
  const path: Geometry = {
    type: "LineString",
    coordinates: [
      [2, -2],
      [2, 12],
    ],
  };
  expect(spatial.crossings(path, footprint)).toEqual([
    { x: 2, y: 0, z: 0 },
    { x: 2, y: 10, z: 0 },
  ]);
  expect(() =>
    spatial.read({
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [4, 4],
          [0, 4],
          [4, 0],
          [0, 0],
        ],
      ],
    })
  ).toThrow();
});

it("refines inherited fields over arbitrary coverage with reciprocal adjacency", () => {
  const parent = createGrid("parent", scope(rectangle([0, 0, 20, 20])), 5, 5);
  putChannel(
    parent,
    "elevation",
    "metre",
    Float64Array.from(parent.active, (_v, i) => {
      const p = gridPosition(parent, i);
      return 100 + p.x * 2 + p.y;
    })
  );
  const triangle: Geometry = {
    type: "Polygon",
    coordinates: [
      [
        [2, 2],
        [18, 2],
        [2, 18],
        [2, 2],
      ],
    ],
  };
  const child = createGrid("child", scope(triangle), 9, 9);
  resample(parent, child, "elevation");
  expect(sample(child, "elevation", { x: 6, y: 4, z: 0 })).toBe(116);
  expect([...child.measures].reduce((a, b) => a + b, 0)).toBeCloseTo(spatial.area(triangle), 8);
  for (let i = 0; i < child.active.length; i++)
    if (child.active[i])
      for (const j of neighbors(child, i)) expect(neighbors(child, j)).toContain(i);
  expect(() => sample(child, "elevation", { x: 18, y: 18, z: 0 })).toThrow();
});
