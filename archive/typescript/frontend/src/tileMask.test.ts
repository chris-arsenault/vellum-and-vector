import { expect, it } from "vitest";
import type { Geometry } from "geojson";
import { polygonTileMask } from "./tileMask";

const square = (x0: number, y0: number, x1: number, y1: number): number[][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0],
];
/** Rows from north to south, as the tile sampler lays out pixels. */
const rows = (mask: Uint8Array, size: number) =>
  Array.from({ length: size }, (_, r) => [...mask.subarray(r * size, (r + 1) * size)].join(""));

it("marks pixel centres inside a polygon, rows from the north", () => {
  const shape: Geometry = { type: "Polygon", coordinates: [square(0, 0, 2, 3)] };
  expect(rows(polygonTileMask(shape, [0, 0, 4, 4], 4), 4)).toEqual([
    "0000",
    "1100",
    "1100",
    "1100",
  ]);
});

it("leaves holes open and fills every part of a multipolygon", () => {
  const shape: Geometry = {
    type: "MultiPolygon",
    coordinates: [[square(0, 0, 3, 3), square(1, 1, 2, 2)], [square(3, 3, 4, 4)]],
  };
  expect(rows(polygonTileMask(shape, [0, 0, 4, 4], 4), 4)).toEqual([
    "0001",
    "1110",
    "1010",
    "1110",
  ]);
});

it("covers a whole tile inside a shape whose edges all lie beyond it", () => {
  const shape: Geometry = { type: "Polygon", coordinates: [square(-100, -100, 100, 100)] };
  expect(polygonTileMask(shape, [10, 10, 14, 14], 4).every((v) => v === 1)).toBe(true);
  expect(polygonTileMask(shape, [200, 10, 204, 14], 4).every((v) => v === 0)).toBe(true);
});

it("folds samples east of a cylindrical chart back into it", () => {
  const shape: Geometry = { type: "Polygon", coordinates: [square(0, 0, 2, 4)] };
  const fold = (x: number) => ((x % 10) + 10) % 10;
  expect(rows(polygonTileMask(shape, [8, 0, 12, 4], 4, fold), 4)[0]).toEqual("0011");
});
