import type { Database } from "@sqlite.org/sqlite-wasm";
import type { Geometry } from "geojson";
import { afterEach, expect, it, vi } from "vitest";
import { rectangle } from "@atlas/domain";
import { fixture, query, record, scope, write } from "./catalogFixture";

// The GEOS module is shared by every kernel; spies on it must not outlive a test.
afterEach(() => {
  vi.restoreAllMocks();
});

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
  // Exact spatial reads derive pieces without computing display scales.
  expect(Number(db.selectValue("SELECT count(*) FROM geometry_pieces"))).toBe(0);
  const canonical = (await catalog.readFeature(scope, "coast")).geometry;
  const extent: [number, number, number, number] = [300, 0, 700, 150];
  const local = (await catalog.readDisplay(query({ extent }), 0)).records[0].feature.geometry;
  expect(Number(db.selectValue("SELECT count(*) FROM geometry_pieces"))).toBeGreaterThan(2);
  expect(Number(db.selectValue("SELECT count(*) FROM geometry_overviews"))).toBe(0);
  const expected = kernel.overlay(canonical, rectangle(extent), 1e-6, "intersection")!;
  const shown = kernel.overlay(local, rectangle(extent), 1e-6, "intersection")!;
  expect(kernel.measure(shown, 1e-6).area).toBeCloseTo(kernel.measure(expected, 1e-6).area, 3);
  expect(kernel.withGeometry(local, 1e-6, (g) => kernel.bounds(g))[3]).toBeLessThan(151);
  expect(JSON.stringify(local).length).toBeLessThan(JSON.stringify(canonical).length / 4);
  expect((await catalog.readDisplay(query({ extent: [499, 499, 501, 501] }), 8)).records).toEqual(
    []
  );
  const overview = (await catalog.readDisplay(query(), 8)).records[0].feature.geometry;
  const overviewCount = Number(db.selectValue("SELECT count(*) FROM geometry_overviews"));
  expect(overviewCount).toBe(1);
  expect(db.selectValues("SELECT tolerance FROM geometry_overviews")).toEqual([8]);
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
it("tests small features without pieces and simplifies each tolerance once", async () => {
  let db!: Database;
  const catalog = await fixture((opened) => {
    db = opened;
  });
  await write(catalog, [
    record("wood", { type: "Polygon", coordinates: [circle(40, 64)] }),
    record("far", rectangle([900, 900, 950, 950])),
  ]);
  const simplify = vi.spyOn(catalog.kernel.native, "GEOSTopologyPreserveSimplify");
  const read = () => catalog.readDisplay(query({ extent: [400, 400, 600, 600] }), 4);
  const first = (await read()).records.map((r) => r.feature);
  expect(first.map((f) => f.id)).toEqual(["wood"]);
  expect(simplify).toHaveBeenCalledTimes(1);
  expect((await read()).records.map((r) => r.feature)).toEqual(first);
  expect(simplify).toHaveBeenCalledTimes(1);
  expect(Number(db.selectValue("SELECT count(*) FROM geometry_pieces"))).toBe(0);
});
it("clips a large feature to a window once and reads the stored window afterwards", async () => {
  const catalog = await fixture();
  await write(catalog, [record("coast", { type: "Polygon", coordinates: [circle(450, 16384)] })]);
  const read = () => catalog.readDisplay(query({ extent: [0, 0, 512, 512] }), 2);
  const first = (await read()).records[0].feature.geometry;
  const clip = vi.spyOn(catalog.kernel.native, "GEOSIntersectionPrec");
  const simplify = vi.spyOn(catalog.kernel.native, "GEOSTopologyPreserveSimplify");
  expect((await read()).records[0].feature.geometry).toEqual(first);
  expect(clip).not.toHaveBeenCalled();
  expect(simplify).not.toHaveBeenCalled();
});
it("batches a cold display page's cache writes instead of committing each geometry", async () => {
  let db!: Database;
  const catalog = await fixture((opened) => {
    db = opened;
  });
  await write(catalog, [record("a"), record("b"), record("c")]);
  let depth = 0;
  const savepoint = db.savepoint.bind(db),
    exec = db.exec.bind(db),
    writes: number[] = [];
  vi.spyOn(db, "savepoint").mockImplementation((callback) => {
    depth++;
    try {
      return savepoint(callback);
    } finally {
      depth--;
    }
  });
  vi.spyOn(db, "exec").mockImplementation((...args) => {
    const value = args[0],
      sql =
        typeof value === "string"
          ? value
          : typeof value === "object" && value !== null && "sql" in value
            ? String(value.sql)
            : "";
    if (sql.includes("INSERT OR REPLACE INTO geometry_display")) writes.push(depth);
    return exec(...args);
  });
  const page = await catalog.readDisplay(query(), 4);
  expect(page.records.map((r) => r.feature.id)).toEqual(["a", "b", "c"]);
  expect(writes).toHaveLength(3);
  expect(writes.every((level) => level > 0)).toBe(true);
});
