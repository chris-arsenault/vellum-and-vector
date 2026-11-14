import { beforeAll, expect, it } from "vitest";
import { GeometryKernel } from "./geometryKernel";
import { rustSpatial } from "./rustSpatial";

const square = JSON.stringify({
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
      [0, 0],
    ],
  ],
});
let spatial: ReturnType<typeof rustSpatial>;
beforeAll(async () => {
  spatial = rustSpatial(await GeometryKernel.create(), 0.001);
});

it("uses the existing GEOS kernel for complete geometry and point batches", () => {
  expect(spatial.area(square)).toBe(16);
  expect([...spatial.coversPoints(square, new Float64Array([0, 0, 1, 1, 5, 5]))]).toEqual([
    1, 1, 0,
  ]);
  expect(spatial.relation(square, square, "covers")).toBe(true);
  expect(JSON.parse(spatial.bounds(square))).toEqual([0, 0, 4, 4]);
});
it("retains linear referencing and reports invalid point batches", () => {
  const line = JSON.stringify({
    type: "LineString",
    coordinates: [
      [0, 0],
      [10, 0],
    ],
  });
  expect(spatial.lineFraction(line, "[3,2]")).toBe(0.3);
  expect([...spatial.lineFractions(line, new Float64Array([3, 2, 8, -2]))]).toEqual([0.3, 0.8]);
  expect(() => spatial.lineFractions(line, new Float64Array([1]))).toThrow("XY pairs");
  expect(JSON.parse(spatial.lineAt(line, 0.4))).toEqual([4, 0, 0]);
  expect(() => spatial.coversPoints(square, new Float64Array([1]))).toThrow("XY pairs");
});
it("keeps ordered trace revisits and GEOS polygonization across the worker boundary", () => {
  const trace = JSON.stringify({
    type: "LineString",
    coordinates: [
      [-1, 2],
      [5, 2],
      [-1, 2],
    ],
  });
  expect(JSON.parse(spatial.clipTrace(trace, square))).toEqual({
    type: "MultiLineString",
    coordinates: [
      [
        [0, 2],
        [4, 2],
      ],
      [
        [4, 2],
        [0, 2],
      ],
    ],
  });
  const boundary = JSON.stringify({
    type: "LineString",
    coordinates: JSON.parse(square).coordinates[0],
  });
  const faces = JSON.parse(spatial.polygonize(boundary));
  expect(faces).toHaveLength(1);
  expect(spatial.area(JSON.stringify(faces[0]))).toBe(16);
  expect(() => spatial.resampleTrace(square, 1)).toThrow("Trace clipping requires");
});
it("owns scoped native indices and preserves site identities", () => {
  const points = "[[1,2],[3,2],[1,2]]";
  const edges = JSON.parse(spatial.delaunayEdges(points)) as number[][];
  expect(edges).toHaveLength(1);
  expect(edges[0]).toEqual(expect.arrayContaining([1, 2]));
  const cells = JSON.parse(spatial.voronoiCells(points, "[0,0,4,4]"));
  expect(cells).toHaveLength(3);
  expect(spatial.area(JSON.stringify(cells[0]))).toBe(8);
  const index = spatial.index(`[${square},{"type":"Point","coordinates":[8,8]}]`);
  expect(JSON.parse(index.query("[0,0,8,8]"))).toEqual([0, 1]);
  expect(index.nearest("[9,9]")).toBe(1);
  expect([...index.nearestMany(new Float64Array([9, 9, 1, 1, 8, 8]))]).toEqual([1, 0, 1]);
  expect([...index.nearestMany(new Float64Array())]).toEqual([]);
  expect(() => index.nearestMany(new Float64Array([1]))).toThrow("XY pairs");
  index.close();
  index.close();
  expect(() => index.query("[0,0,1,1]")).toThrow("scope has ended");
  expect(() => index.nearestMany(new Float64Array([1, 1]))).toThrow("scope has ended");
  const empty = spatial.index("[]");
  expect([...empty.nearestMany(new Float64Array([1, 1, 8, 8]))]).toEqual([-1, -1]);
  empty.close();
});
it("batches reusable masks and windows with input-minus-mask difference", () => {
  const inputs = JSON.stringify([
    {
      type: "Polygon",
      coordinates: [
        [
          [2, 2],
          [6, 2],
          [6, 6],
          [2, 6],
          [2, 2],
        ],
      ],
    },
    {
      type: "Polygon",
      coordinates: [
        [
          [10, 10],
          [12, 10],
          [12, 12],
          [10, 12],
          [10, 10],
        ],
      ],
    },
  ]);
  expect(JSON.parse(spatial.relations(square, inputs, "intersects"))).toEqual([true, false]);
  expect(JSON.parse(spatial.intersectionAreas(square, inputs))).toEqual([4, 0]);
  const differences = JSON.parse(spatial.overlays(square, inputs, "difference"));
  expect(differences.map((g: unknown) => spatial.area(JSON.stringify(g)))).toEqual([12, 4]);
  const windows = JSON.parse(spatial.clipWindows(square, "[[1,1,3,3],[8,8,9,9]]"));
  expect(spatial.area(JSON.stringify(windows[0]))).toBe(4);
  expect(windows[1]).toBeNull();
});
