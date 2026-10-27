import { afterEach, expect, it } from "vitest";
import {
  configureSpatial,
  Spatial,
  spatial,
  rectangle,
  createGrid,
  fieldContour,
} from "@atlas/domain";
import { landscape } from "../../generation/src/mapFixtures";
import { GeometryKernel } from "./geometryKernel";
import { GeosSpatial } from "./geosSpatial";

let kernel: GeometryKernel | undefined;
afterEach(() => {
  configureSpatial();
  kernel?.close();
  kernel = undefined;
});
async function configure() {
  kernel = await GeometryKernel.create(128);
  configureSpatial((precision) => new GeosSpatial(kernel!, precision));
}
it("routes domain spatial operations through native precision and bounded prepared predicates", async () => {
  await configure();
  const a = rectangle([0, 0, 100, 100]),
    b = rectangle([50, 0, 150, 100]);
  const covers = spatial.pointCoverage(a);
  expect(covers({ x: 0, y: 10, z: 0 })).toBe(true);
  expect(covers({ x: -1, y: 10, z: 0 })).toBe(false);
  expect(spatial.area(spatial.intersection(a, b)!)).toBe(5000);
  expect(spatial.area(spatial.differenceFrom(b)(a)!)).toBe(5000);
  expect(spatial.area(spatial.unionAll([a, b]))).toBe(15000);
  expect(spatial.intersectionArea(a)(b)).toBe(5000);
  expect(spatial.distance(a, rectangle([110, 0, 120, 10]))).toBe(10);
  expect(spatial.geometryCoverage(a)(rectangle([1, 1, 2, 2]))).toBe(true);
  expect(
    spatial.covers(a, {
      type: "Point",
      coordinates: Object.values(spatial.interiorPosition(a)).slice(0, 2),
    })
  ).toBe(true);
  expect(new Spatial(0.1).canonical({ type: "Point", coordinates: [1.04, 2.06, 0] })).toEqual({
    type: "Point",
    coordinates: [1, 2.1, 0],
  });
  expect(covers({ x: 50, y: 50, z: 0 })).toBe(true);
});
it("nodes the reported nearly coincident lines and preserves directed crossings", async () => {
  await configure();
  const a = {
    type: "LineString" as const,
    coordinates: [
      [2657949.4244115246, 2574200.0673285],
      [2657949.8562551714, 2574199.8180034542],
    ],
  };
  const b = {
    type: "LineString" as const,
    coordinates: [
      [2657949.736258257, 2574199.887283705],
      [2657884.6130642365, 2574237.4861772484],
    ],
  };
  expect(
    spatial.nodeLines({ type: "MultiLineString", coordinates: [a.coordinates, b.coordinates] }).type
  ).toBe("MultiLineString");
  expect(
    spatial.crossings(
      {
        type: "LineString",
        coordinates: [
          [-1, 50],
          [101, 50],
        ],
      },
      rectangle([0, 0, 100, 100])
    )
  ).toEqual(
    expect.arrayContaining([
      { x: 0, y: 50, z: 0 },
      { x: 100, y: 50, z: 0 },
    ])
  );
  expect(
    spatial.delaunayEdges([
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 0, y: 10, z: 0 },
    ])
  ).toHaveLength(3);
});
it("polygonizes sampled contour faces with holes through the configured GEOS engine", async () => {
  await configure();
  const scope = { ...landscape().domain.scope, footprint: rectangle([0, 0, 100, 100]) },
    grid = createGrid("contour", scope, 11, 11);
  const shape = fieldContour(
    grid,
    (x, y) => {
      const radius = Math.hypot(x - 50, y - 50);
      return Math.min(radius - 15, 40 - radius);
    },
    undefined,
    0,
    0.5
  )!;
  expect(spatial.covers(shape, { type: "Point", coordinates: [50, 50] })).toBe(false);
  expect(spatial.covers(shape, { type: "Point", coordinates: [75, 50] })).toBe(true);
  expect(spatial.covers(shape, { type: "Point", coordinates: [95, 50] })).toBe(false);
  expect(spatial.area(shape)).toBeGreaterThan(4000);
});
