import type { Database } from "@sqlite.org/sqlite-wasm";
import { expect, it } from "vitest";
import { rectangle, spatial } from "@atlas/domain";
import { fixture, scope, record, write } from "./catalogFixture";

it("traces one component of a large source without loading its distant boundary pieces", async () => {
  let db!: Database;
  const catalog = await fixture((opened) => {
    db = opened;
  }, 100);
  const circle = (x: number, y: number, radius: number) => {
    const ring = Array.from({ length: 1024 }, (_, i) => [
      x + radius * Math.cos((i * 2 * Math.PI) / 1024),
      y + radius * Math.sin((i * 2 * Math.PI) / 1024),
    ]);
    return [[...ring, ring[0]]];
  };
  await write(catalog, [
    record("islands", {
      type: "MultiPolygon",
      coordinates: [circle(250, 250, 150), circle(800, 800, 100)],
    }),
  ]);
  const selected = await catalog.regionChoices({
    scope,
    sourceAreaId: scope.areaId,
    parentId: null,
    editingId: null,
    cuts: [],
    position: { x: 250, y: 250, z: 0 },
    viewport: [0, 0, 500, 500],
  });
  expect(
    selected.candidates.some(
      (candidate) => Math.abs(spatial.area(candidate.footprint) - Math.PI * 150 ** 2) < 1
    )
  ).toBe(true);
  const prepared = Number(db.selectValue("SELECT count(*) FROM boundary_segments"));
  expect(prepared).toBeGreaterThanOrEqual(1024);
  expect(prepared).toBeLessThan(2048);
  expect(db.selectValue("SELECT max(max_y) FROM boundary_bounds")).toBeLessThan(500);
});

it("indexes the selected neighborhood without preparing unrelated map boundaries", async () => {
  let db!: Database;
  const catalog = await fixture((opened) => {
    db = opened;
  }, 100);
  await write(catalog, [
    record("local", rectangle([10, 10, 310, 310])),
    record("remote", rectangle([700, 700, 900, 900])),
  ]);
  const query = {
    scope,
    sourceAreaId: scope.areaId,
    parentId: null,
    editingId: null,
    cuts: [],
    position: { x: 50, y: 50, z: 0 },
    viewport: [0, 0, 200, 200] as [number, number, number, number],
  };
  const selected = await catalog.regionChoices(query);
  expect(selected.candidates.some((c) => spatial.area(c.footprint) === 90000)).toBe(true);
  expect(
    db.selectValues(
      "SELECT r.id FROM boundary_sources s JOIN records_core r USING(record_id) ORDER BY r.id"
    )
  ).toEqual(["local"]);
  const remote = await catalog.regionChoices({ ...query, position: { x: 800, y: 800, z: 0 } });
  expect(remote.candidates.some((c) => spatial.area(c.footprint) === 40000)).toBe(true);
  expect(
    db.selectValues(
      "SELECT r.id FROM boundary_sources s JOIN records_core r USING(record_id) ORDER BY r.id"
    )
  ).toEqual(["local", "remote"]);
  const changed = (await catalog.readRecords(scope, "feature", ["local"]))[0];
  if (changed.data.kind !== "feature") throw new Error("Missing test feature");
  changed.data.value.geometry = rectangle([20, 20, 420, 420]);
  await write(catalog, [changed]);
  const updated = await catalog.regionChoices(query);
  expect(updated.candidates.some((c) => spatial.area(c.footprint) === 160000)).toBe(true);
});
