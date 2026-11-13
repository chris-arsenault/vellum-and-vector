import { expect, it } from "vitest";
import type { DrainageNetwork, RetainedRiver } from "@atlas/domain";
import { createTestField } from "../rock/groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { inheritRivers } from "./networkImport";

it("imports a published map's river identity before any water pass", () => {
  const map = createTestField(createWorldMesh([0, 0, 10_000, 10_000], 64, 0));
  inheritRivers(
    map,
    {
      areaId: "parent",
      spaceId: "surface",
      input: true,
      reaches: [
        {
          downstream: null,
          waterBody: null,
          basin: 1,
          order: 2,
          coordinates: [
            [-1000, 5000],
            [11000, 5000],
          ],
          discharges: [30, 40],
          catchmentAreas: [100_000, 110_000],
          featureIds: ["parent-record"],
        },
      ],
    },
    () => ({ name: "Long River", attributes: { riverId: "parent-river" } })
  );
  const reach = [...map.rivers.reaches.values()][0];
  expect(reach.river).toBe("parent-river");
  expect(reach.name).toBe("Long River");
  expect(reach.record).toBe("river:parent-river:0");
  expect(map.rivers.entries[0].monthly[0]).toBeGreaterThan(30);
});

it("imports a captured river as an owned course and brings its actual months across the boundary", () => {
  const map = createTestField(createWorldMesh([0, 0, 10_000, 10_000], 64, 0));
  const input: RetainedRiver = {
    id: 1,
    course: [
      [-1000, 5000],
      [11000, 5000],
    ],
    downstream: null,
    order: 2,
    flow: 20,
    least: 0,
    flood: 40,
    months: 6,
    dry: false,
    drawn: true,
    river: "named-river",
    former: [],
    monthly: Array.from({ length: 24 }, (_, n) => (n % 12 < 6 ? 40 : 0)),
    catchment: [100_000, 100_000],
    bed: [100, 90],
    width: [10, 10],
    depth: [1, 1],
    leakage: [0, 0],
  };
  const network: DrainageNetwork = {
    areaId: "captured",
    spaceId: "surface",
    reaches: [],
    input: true,
    kept: { next: 2, reaches: [input], entries: [] },
  };
  inheritRivers(map, network);
  const reach = [...map.rivers.reaches.values()][0];
  expect(reach.river).toBe("named-river");
  expect(reach.cells.length).toBeGreaterThan(2);
  expect(reach.monthly[0]).toBe(40);
  expect(reach.monthly[6]).toBe(0);
  expect(Array.from(reach.width).every((width) => width === 10)).toBe(true);
  expect(Array.from(reach.depth).every((depth) => depth === 1)).toBe(true);
  expect(reach.bed[0]).toBeGreaterThan(90);
  expect(reach.bed[0]).toBeLessThan(100);
  expect(map.rivers.entries[0].monthly[0]).toBe(40);
  expect(map.rivers.entries[0].monthly[6]).toBe(0);
  input.monthly[0] = 999;
  expect(reach.monthly[0]).toBe(40);
});
