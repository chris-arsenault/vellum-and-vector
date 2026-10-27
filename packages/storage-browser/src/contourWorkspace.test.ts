import { afterEach, expect, it } from "vitest";
import type { Database } from "@sqlite.org/sqlite-wasm";
import {
  configureSpatial,
  createGrid,
  fieldContour,
  linearFieldContour,
  rectangle,
  spatial,
  type ContourPoint,
  type LinearContourSample,
} from "@atlas/domain";
import { landscape } from "../../generation/src/mapFixtures";
import { fixture } from "./catalogFixture";
import { SqliteContourWorkspace } from "./contourWorkspace";
import { GeometryKernel } from "./geometryKernel";
import { GeosSpatial } from "./geosSpatial";
import { contourLines, withContourEdges } from "../../domain/src/contourLines";

let kernel: GeometryKernel | undefined;
afterEach(() => {
  configureSpatial();
  kernel?.close();
  kernel = undefined;
});
async function working() {
  let db!: Database;
  await fixture((value) => {
    db = value;
  });
  kernel = await GeometryKernel.create(1024);
  configureSpatial((precision) => new GeosSpatial(kernel!, precision));
  const workspace = new SqliteContourWorkspace(db);
  const scope = { ...landscape().domain.scope, footprint: rectangle([0, 0, 1000, 1000]) };
  return { workspace, db, grid: createGrid("contours", scope, 61, 51) };
}
it("traces the complete shore and its holes through indexed working edges", async () => {
  const { workspace, db, grid } = await working();
  const shore = fieldContour(grid, (x, y) => x + y * 0.1 - 500, undefined, 0, 0.1, workspace)!;
  expect(spatial.area(shore)).toBeCloseTo(550000, 1);
  const lake = fieldContour(
    grid,
    (x, y) => {
      const distance = Math.hypot(x - 500, y - 500);
      return Math.min(350 - distance, distance - 100);
    },
    undefined,
    0,
    0.1,
    workspace
  )!;
  expect(spatial.area(lake) / (Math.PI * (350 ** 2 - 100 ** 2))).toBeCloseTo(1, 3);
  expect(spatial.covers(lake, { type: "Point", coordinates: [500, 500] })).toBe(false);
  expect(spatial.covers(lake, { type: "Point", coordinates: [700, 500] })).toBe(true);
  expect(db.selectValue("SELECT count(*) FROM contour_edges")).toBe(0);
});
it("assembles a long closed shore across bounded line batches without retaining its ring", async () => {
  const { workspace, db } = await working();
  let largest = 0,
    batches = 0;
  const shape = withContourEdges(workspace, (edges) => {
    // A rectangle with 9000 boundary segments and a separate interior hole.
    for (const [x, y, dx, dy] of [
      [0, 0, 1, 0],
      [3000, 0, 0, 1],
      [3000, 1500, -1, 0],
      [0, 1500, 0, -1],
    ]) {
      const length = dx ? 3000 : 1500;
      for (let i = 0; i < length; i++)
        edges.add([x + dx * i, y + dy * i], [x + dx * (i + 1), y + dy * (i + 1)]);
    }
    const hole: ContourPoint[] = [
      [100, 100],
      [200, 100],
      [200, 200],
      [100, 200],
      [100, 100],
    ];
    for (let i = 1; i < hole.length; i++) edges.add(hole[i - 1], hole[i]);
    function* lines() {
      for (const coordinates of contourLines(edges)) {
        largest = Math.max(largest, coordinates.length);
        batches++;
        yield coordinates;
      }
    }
    return spatial.polygonizeArea(
      lines(),
      ({ x, y }) => !(x > 100 && x < 200 && y > 100 && y < 200)
    );
  })!;
  expect(batches).toBeGreaterThan(2);
  expect(largest).toBeLessThan(9000);
  expect(spatial.area(shape)).toBe(4_490_000);
  expect(spatial.covers(shape, { type: "Point", coordinates: [150, 150] })).toBe(false);
  expect(spatial.covers(shape, { type: "Point", coordinates: [2500, 500] })).toBe(true);
  expect(db.selectValue("SELECT count(*) FROM contour_edges")).toBe(0);
});
it("closes linear contours at the chart edge without joining separate working graphs", async () => {
  const { workspace, db } = await working();
  const held = workspace.open();
  for (let i = 0; i < 300; i++) held.add([i, 0], [i + 1, 0]);
  const a: LinearContourSample = [0, 0, 0],
    b: LinearContourSample = [1, 0, 1],
    c: LinearContourSample = [1, 1, 1],
    d: LinearContourSample = [0, 1, 0];
  const shape = linearFieldContour(
    [
      [a, b, c],
      [a, c, d],
    ],
    (x) => x,
    0.5,
    [
      [a, b],
      [b, c],
      [c, d],
      [d, a],
    ],
    workspace
  )!;
  expect(spatial.area(shape)).toBe(0.5);
  expect(held.first()!.a).toEqual([0, 0]);
  expect(held.outgoing([256, 0])[0].b).toEqual([257, 0]);
  held.close();
  expect(db.selectValue("SELECT count(*) FROM contour_edges")).toBe(0);
});
it("releases stored and buffered edges after a failed extraction without deleting another graph", async () => {
  const { workspace, db } = await working();
  const held = workspace.open();
  held.add([0, 0], [1, 0]);
  held.first();
  expect(() =>
    withContourEdges(workspace, (edges) => {
      for (let i = 0; i < 300; i++) edges.add([i, 0], [i + 1, 0]);
      throw new Error("sampling failed");
    })
  ).toThrow("sampling failed");
  expect(db.selectValue("SELECT count(*) FROM contour_edges")).toBe(1);
  expect(held.first()!.b).toEqual([1, 0]);
  held.close();
});
it("consumes rings once and assembles disconnected islands and nested holes natively", async () => {
  await working();
  const ring = (x: number, y: number, size: number): ContourPoint[] => [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
    [x, y],
  ];
  function* boundaries() {
    yield ring(0, 0, 10);
    yield ring(2, 2, 6);
    for (let i = 0; i < 130; i++) {
      const coordinates = ring(20 + i * 2, 0, 1);
      yield coordinates;
      // A streaming consumer must have read the previous ring before requesting another.
      for (const point of coordinates) point.fill(NaN);
    }
  }
  const shape = spatial.polygonizeArea(
    boundaries(),
    ({ x, y }) => !(x > 2 && x < 8 && y > 2 && y < 8)
  )!;
  expect(spatial.area(shape)).toBe(194);
  expect(spatial.covers(shape, { type: "Point", coordinates: [5, 5] })).toBe(false);
  expect(spatial.covers(shape, { type: "Point", coordinates: [278.5, 0.5] })).toBe(true);
  expect(spatial.polygonizeArea([], () => true)).toBeNull();
  expect(() =>
    spatial.polygonizeArea([ring(0, 0, 1)], () => {
      throw new Error("field unavailable");
    })
  ).toThrow("field unavailable");
  expect(spatial.area(spatial.polygonizeArea([ring(0, 0, 1)], () => true)!)).toBe(1);
});
