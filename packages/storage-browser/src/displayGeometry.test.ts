import type { Database } from "@sqlite.org/sqlite-wasm";
import type { Geometry } from "geojson";
import { expect, it } from "vitest";
import { rectangle } from "@atlas/domain";
import { fixture, query, record, scope, write } from "./catalogFixture";

it("partitions mixed-dimensional geography and preserves its areas, lines and points", async () => {
  const catalog = await fixture(),
    kernel = catalog.kernel;
  const shape: Geometry = {
    type: "GeometryCollection",
    geometries: [
      { type: "Polygon", coordinates: [circle(450, 8192)] },
      {
        type: "LineString",
        coordinates: [
          [10, 10],
          [990, 10],
        ],
      },
      { type: "Point", coordinates: [25, 25] },
    ],
  };
  await write(catalog, [record("mixed", shape)]);
  const canonical = (await catalog.readFeature(scope, "mixed")).geometry;
  const shown = (await catalog.readDisplay(query(), 0)).records[0].feature.geometry;
  const measured = kernel.measure(canonical, 1e-6),
    displayed = kernel.measure(shown, 1e-6);
  expect(displayed.area).toBeCloseTo(measured.area, 3);
  expect(displayed.length).toBeCloseTo(measured.length, 3);
  expect(kernel.relation(shown, { type: "Point", coordinates: [25, 25] }, 1e-6, "covers")).toBe(
    true
  );
  expect((await catalog.readFeature(scope, "mixed")).geometry).toEqual(canonical);
});

function circle(radius: number, count: number) {
  const points = Array.from({ length: count }, (_, i) => [
    500 + radius * Math.cos((i * 2 * Math.PI) / count),
    500 + radius * Math.sin((i * 2 * Math.PI) / count),
  ]);
  return [...points, points[0]];
}
it("reads joined viewport pieces, preserves holes and edits canonical geometry through undo", async () => {
  let db!: Database;
  const catalog = await fixture((opened) => {
      db = opened;
    }),
    kernel = catalog.kernel;
  const shape: Geometry = {
    type: "Polygon",
    coordinates: [circle(450, 16384), circle(100, 4096).reverse()],
  };
  await write(catalog, [record("coast", shape)]);
  // Writes store the geometry row only; the first display read derives pieces and overviews.
  expect(Number(db.selectValue("SELECT count(*) FROM geometry_pieces"))).toBe(0);
  const canonical = (await catalog.readFeature(scope, "coast")).geometry;
  const extent: [number, number, number, number] = [300, 0, 700, 150];
  const local = (await catalog.readDisplay(query({ extent }), 0)).records[0].feature.geometry;
  expect(Number(db.selectValue("SELECT count(*) FROM geometry_pieces"))).toBeGreaterThan(2);
  const overviewCount = Number(db.selectValue("SELECT count(*) FROM geometry_overviews"));
  expect(overviewCount).toBeGreaterThan(0);
  const expected = kernel.overlay(canonical, rectangle(extent), 1e-6, "intersection")!;
  const shown = kernel.overlay(local, rectangle(extent), 1e-6, "intersection")!;
  expect(kernel.measure(shown, 1e-6).area).toBeCloseTo(kernel.measure(expected, 1e-6).area, 3);
  expect(kernel.withGeometry(local, 1e-6, (g) => kernel.bounds(g))[3]).toBeLessThan(151);
  expect(JSON.stringify(local).length).toBeLessThan(JSON.stringify(canonical).length / 4);
  expect((await catalog.readDisplay(query({ extent: [499, 499, 501, 501] }), 8)).records).toEqual(
    []
  );
  const overview = (await catalog.readDisplay(query(), 8)).records[0].feature.geometry;
  expect(JSON.stringify(overview).length).toBeLessThan(JSON.stringify(canonical).length / 10);
  expect((await catalog.readFeature(scope, "coast")).geometry).toEqual(canonical);
  const changed = (await catalog.readRecords(scope, "feature", ["coast"]))[0];
  if (changed.data.kind !== "feature") throw new Error("Missing coast");
  changed.data.value.geometry = rectangle([20, 20, 120, 120]);
  const commit = await write(catalog, [changed]);
  expect((await catalog.readDisplay(query({ extent }), 0)).records).toEqual([]);
  await catalog.undo(scope.worldId, commit.operationId);
  expect((await catalog.readFeature(scope, "coast")).geometry).toEqual(canonical);
  expect((await catalog.readDisplay(query({ extent }), 0)).records[0].feature.geometry).toEqual(
    local
  );
  expect(Number(db.selectValue("SELECT count(*) FROM geometry_overviews"))).toBe(overviewCount);
});
