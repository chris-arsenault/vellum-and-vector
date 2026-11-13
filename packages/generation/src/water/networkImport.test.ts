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

it("keeps a published confluence's receiving sample outside the tributary's owned profile", () => {
  const map = createTestField(createWorldMesh([0, 0, 10_000, 10_000], 64, 0)),
    receiver = map.mesh.cellAt(5000, 5000),
    upper = map.mesh.neighbor(receiver, 0),
    lower = map.mesh.neighbor(receiver, 1),
    position = (cell: number): [number, number] => [
      map.mesh.x(cell) + map.mesh.origin[0],
      map.mesh.y(cell) + map.mesh.origin[1],
    ],
    record = (cells: number[], downstream: number | null, discharges: number[]) => ({
      downstream,
      waterBody: null,
      basin: 1,
      order: 1,
      coordinates: cells.map(position),
      discharges,
      catchmentAreas: [100_000, 900_000],
      featureIds: [],
    });
  inheritRivers(map, {
    areaId: "published",
    spaceId: "surface",
    input: true,
    reaches: [record([upper, receiver], 1, [40, 999]), record([receiver, lower], null, [500, 500])],
  });
  const [tributary, receiving] = [...map.rivers.reaches.values()];
  expect(tributary.cells).toEqual([upper]);
  expect(Array.from(tributary.monthly)).toEqual(Array(12).fill(40));
  expect(tributary.catchment[0]).toBe(100_000);
  expect(tributary.downstream).toBe(receiving.id);
  expect(receiving.monthly[0]).toBe(500);
});

it("imports incoming water at a course's re-entry even when its original head is inside", () => {
  const map = createTestField(createWorldMesh([0, 0, 10_000, 10_000], 64, 0));
  inheritRivers(map, {
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
          [1000, 2000],
          [11000, 2000],
          [11000, 8000],
          [1000, 8000],
        ],
        discharges: [10, 20, 30, 40],
        catchmentAreas: [100, 200, 300, 400],
        featureIds: [],
      },
    ],
  });
  expect(map.rivers.reaches.size).toBe(2);
  expect(map.rivers.entries).toHaveLength(1);
  expect(map.rivers.entries[0].monthly[0]).toBeGreaterThan(30);
  expect(map.rivers.entries[0].monthly[0]).toBeLessThan(40);
  expect(map.rivers.entries[0].catchment).toBeGreaterThan(300);
});

it("retains a shared-boundary head's actual supply once and derives its later re-entry separately", () => {
  const map = createTestField(createWorldMesh([0, 0, 10_000, 10_000], 64, 0)),
    monthly = Array.from({ length: 12 }, (_, month) => (month < 6 ? 40 : 0)),
    record: RetainedRiver = {
      id: 1,
      course: [
        [0, 2000],
        [11000, 2000],
        [11000, 8000],
        [1000, 8000],
      ],
      downstream: null,
      order: 2,
      flow: 25,
      least: 0,
      flood: 50,
      months: 6,
      dry: false,
      drawn: true,
      river: "boundary-river",
      former: [],
      monthly: Array.from({ length: 48 }, (_, at) => (at % 12 < 6 ? 50 : 0)),
      catchment: [100, 200, 300, 400],
      bed: [],
      width: [],
      depth: [],
      leakage: [],
    },
    network: DrainageNetwork = {
      areaId: "captured",
      spaceId: "surface",
      reaches: [],
      input: true,
      kept: {
        next: 2,
        reaches: [record],
        entries: [
          { position: [0, 2000], monthly, catchment: 90 },
          { position: [20000, 2000], monthly: Array(12).fill(999), catchment: 999 },
        ],
      },
    };
  inheritRivers(map, network);
  expect(map.rivers.entries).toHaveLength(2);
  const inherited = map.rivers.entries.find((entry) => entry.catchment === 90)!,
    crossing = map.rivers.entries.find((entry) => entry.catchment > 300)!;
  expect(Array.from(inherited.monthly)).toEqual(monthly);
  expect(crossing.monthly[0]).toBe(50);
  expect(crossing.monthly[6]).toBe(0);
  expect([...map.rivers.reaches.values()].every((reach) => reach.downstream === null)).toBe(true);
  monthly[0] = 999;
  expect(inherited.monthly[0]).toBe(40);
});

it("imports a former course without treating a one-point current profile as its geometry", () => {
  const map = createTestField(createWorldMesh([0, 0, 10_000, 10_000], 64, 0));
  const record: RetainedRiver = {
    id: 1,
    course: [[11000, 5000]],
    downstream: null,
    order: 2,
    flow: 50,
    least: 50,
    flood: 50,
    months: 12,
    dry: false,
    drawn: true,
    river: "kept-river",
    name: "Kept River",
    former: [
      {
        course: [
          [-1000, 5000],
          [11000, 5000],
        ],
        leftIn: 2,
      },
    ],
    monthly: Array(12).fill(50),
    catchment: [1000],
    bed: [999],
    width: [10],
    depth: [1],
    leakage: [0],
  };
  inheritRivers(map, {
    areaId: "captured",
    spaceId: "surface",
    input: true,
    reaches: [],
    kept: { next: 2, reaches: [record], entries: [] },
  });
  const reach = [...map.rivers.reaches.values()][0];
  expect(reach).toMatchObject({ river: "kept-river", name: "Kept River", dry: true, driedIn: 2 });
  expect(reach.cells.length).toBeGreaterThan(1);
  expect(Array.from(reach.monthly).every((flow) => flow === 0)).toBe(true);
  expect(reach.former).toEqual([]);
  expect(reach.downstream).toBeNull();
  expect(map.rivers.entries).toHaveLength(0);
});

it("imports actual point ownership and its verified outgoing edge without borrowing receiving water", () => {
  const point: RetainedRiver = {
    id: 1,
    course: [[1000, 5000]],
    downstream: null,
    order: 1,
    flow: 20,
    least: 0,
    flood: 40,
    months: 6,
    dry: false,
    drawn: true,
    river: "point-river",
    former: [],
    monthly: Array.from({ length: 12 }, (_, month) => (month < 6 ? 40 : 0)),
    catchment: [100_000],
    bed: [100],
    width: [10],
    depth: [1],
    leakage: [0],
  };
  const importInto = (record: RetainedRiver, receiver?: RetainedRiver) => {
    const map = createTestField(createWorldMesh([0, 0, 10_000, 10_000], 64, 0));
    inheritRivers(map, {
      areaId: "captured",
      spaceId: "surface",
      input: true,
      reaches: [],
      kept: { next: 3, reaches: receiver ? [record, receiver] : [record], entries: [] },
    });
    return map;
  };
  const isolated = importInto(point),
    receiverCell = isolated.mesh.cellAt(5000, 5000),
    upperCell = isolated.mesh.neighbor(receiverCell, 0),
    position = (cell: number): [number, number] => [
      isolated.mesh.x(cell) + isolated.mesh.origin[0],
      isolated.mesh.y(cell) + isolated.mesh.origin[1],
    ],
    connected = importInto(
      { ...point, course: [position(upperCell)], downstream: 2, junction: position(receiverCell) },
      {
        ...point,
        id: 2,
        river: "receiving-river",
        course: [position(receiverCell), position(isolated.mesh.neighbor(receiverCell, 1))],
        monthly: Array(24).fill(200),
        catchment: [200_000, 200_000],
        bed: [100, 90],
        width: [20, 20],
        depth: [2, 2],
        leakage: [0, 0],
      }
    ),
    single = [...isolated.rivers.reaches.values()][0],
    edge = [...connected.rivers.reaches.values()][0];
  expect(single.cells).toHaveLength(1);
  expect(single.river).toBe("point-river");
  expect(Array.from(single.monthly)).toEqual(point.monthly);
  expect(isolated.rivers.entries).toHaveLength(0);
  expect(edge.cells).toEqual([upperCell]);
  expect(edge.downstream).toBe([...connected.rivers.reaches.values()][1].id);
  expect(Array.from(edge.monthly).every((flow, at) => flow === point.monthly[at % 12])).toBe(true);
  expect(connected.rivers.entries).toHaveLength(0);
});
