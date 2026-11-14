import { expect, it } from "vitest";
import { createTestField } from "../rock/groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { addReach } from "./reachEvolution";
import {
  onRiver,
  reachAt,
  retainRiverCourse,
  riverOrderAt,
  riverOrders,
  riverSample,
  riverSuccessor,
  waterAt,
} from "./riverKeeping";
import { projectRiverOrders } from "./riverProjection";

it("answers river questions from retained reaches even when the display layer disagrees", () => {
  const map = createTestField(createWorldMesh([0, 0, 10_000, 10_000], 16, 0));
  const reach = addReach(map.rivers, [1, 2, 3]);
  reach.order = 2;
  reach.drawn = true;
  reach.months = 12;
  map.RiverOrders.fill(0);
  reach.monthly.fill(20, 12, 18);
  reach.width[1] = 30;
  reach.depth[1] = 2;
  reach.catchment[1] = 900;
  map.RiverWidth.set(2, 999);
  map.CatchmentArea.set(2, 999);
  expect(riverSample(map, 2, "width")).toBe(30);
  expect(riverSample(map, 2, "depth")).toBe(2);
  expect(riverSample(map, 2, "catchment")).toBe(900);
  expect(riverSample(map, 2, "months")).toBe(6);
  expect(onRiver(map, 3)).toBe(false);
  map.FloodFlow.set(2, 1000);
  expect(waterAt(map, 2)).toBe(10);
  expect(waterAt(map, 2, "flood")).toBe(20);
  expect(onRiver(map, 2)).toBe(true);
  expect(riverOrderAt(map, 2)).toBe(2);
  map.RiverOrders.set(4, 3);
  expect(onRiver(map, 4)).toBe(false);
  projectRiverOrders(map);
  expect(map.RiverOrders.get(2)).toBe(2);
  expect(map.RiverOrders.get(4)).toBe(0);
  map.RiverOrders.set(4, 5);
  expect(riverOrders(map).get(4)).toBe(0);
});

it("retains a dry course without answering that a river runs in it", () => {
  const map = createTestField(createWorldMesh([0, 0, 10_000, 10_000], 16, 0));
  const reach = addReach(map.rivers, [1, 2, 3]);
  reach.dry = true;
  reach.drawn = true;
  map.RiverOrders.set(2, 1);
  expect(onRiver(map, 2)).toBe(false);
  expect(map.rivers.reaches.get(1)?.dry).toBe(true);
});

it("retains a named place's stream without inventing water or replacing the receiving river", () => {
  const map = createTestField(createWorldMesh([0, 0, 10_000, 10_000], 16, 0)),
    receiving = addReach(map.rivers, [2, 3]);
  receiving.river = "main-river";
  receiving.monthly.fill(20);
  map.FlowAccumulation.set(0, 900);
  const retained = retainRiverCourse(map, [0, 1, 2, 3], "seat-stream", "Town Stream")!;
  expect(retained.cells).toEqual([0, 1]);
  expect(retained.downstream).toBe(receiving.id);
  expect(retained.dry).toBe(true);
  expect(retained.record).toBe("river:seat-stream:0");
  expect(waterAt(map, 0)).toBe(0);
  expect(onRiver(map, 0)).toBe(false);
  expect(retainRiverCourse(map, [2, 3], "another-seat")).toBe(receiving);
  expect(receiving.river).toBe("main-river");
  expect(waterAt(map, 2)).toBe(20);
});

it("splits an interior seat-stream junction while keeping the receiving river and its profiles", () => {
  const map = createTestField(createWorldMesh([0, 0, 10_000, 10_000], 16, 0)),
    receiving = addReach(map.rivers, [2, 3, 4]),
    feeder = addReach(map.rivers, [5]);
  receiving.river = "main-river";
  receiving.record = "main-record";
  receiving.name = "Main River";
  receiving.drawn = true;
  receiving.order = 2;
  receiving.bed.set([100, 90, 80]);
  receiving.width.set([10, 20, 30]);
  receiving.depth.set([1, 2, 3]);
  receiving.catchment.set([1000, 2000, 3000]);
  receiving.leakage.set([4, 5, 6]);
  receiving.cells.forEach((_, at) => receiving.monthly.fill((at + 1) * 20, at * 12, at * 12 + 12));
  feeder.downstream = receiving.id;
  const retained = retainRiverCourse(map, [0, 3, 4], "seat-stream", "Town Stream")!,
    upper = reachAt(map, 2)!;
  expect(receiving.cells).toEqual([3, 4]);
  expect(retained.downstream).toBe(receiving.id);
  expect(upper.cells).toEqual([2]);
  expect(upper.downstream).toBe(receiving.id);
  expect(feeder.downstream).toBe(upper.id);
  expect(upper.drawn).toBe(true);
  expect(upper.order).toBe(2);
  expect(receiving.river).toBe("main-river");
  expect(receiving.record).toBe("main-record");
  expect(receiving.name).toBe("Main River");
  expect(waterAt(map, 0)).toBe(0);
  expect(waterAt(map, 2)).toBe(20);
  expect(waterAt(map, 3)).toBe(40);
  expect(waterAt(map, 4)).toBe(60);
  expect(riverSample(map, 2, "bed")).toBe(100);
  expect(riverSample(map, 3, "bed")).toBe(90);
  expect(riverSample(map, 3, "width")).toBe(20);
  expect(riverSample(map, 3, "depth")).toBe(2);
  expect(riverSample(map, 3, "catchment")).toBe(2000);
  expect(Array.from(upper.leakage)).toEqual([4]);
  expect(Array.from(receiving.leakage)).toEqual([5, 6]);
});

it("reads retained internal and receiving edges when quantity routing disagrees", () => {
  const map = createTestField(createWorldMesh([0, 0, 10_000, 10_000], 64, 0)),
    cell = map.mesh.cellAt(0, 0),
    first = map.mesh.neighbor(cell, 1),
    junction = map.mesh.neighbor(cell, 0),
    upper = addReach(map.rivers, [first, cell]),
    lower = addReach(map.rivers, [junction]);
  upper.downstream = lower.id;
  map.FlowTargets.set(first, -1);
  map.FlowTargets.set(cell, first);
  expect(riverSuccessor(map, first)).toBe(cell);
  expect(riverSuccessor(map, cell)).toBe(junction);
  lower.cells = [map.mesh.cellAt(4000, 4000)];
  map.rivers.at = undefined;
  expect(riverSuccessor(map, cell)).toBe(-1);
});

it("projects a terminal running course only into actual adjacent standing water", () => {
  const map = createTestField(createWorldMesh([0, 0, 10_000, 10_000], 64, 0)),
    cell = map.mesh.cellAt(0, 0),
    water = map.mesh.neighbor(cell, 0),
    reach = addReach(map.rivers, [cell]);
  map.FlowTargets.set(cell, water);
  expect(riverSuccessor(map, cell)).toBe(-1);
  map.WaterKindCodes.set(water, 1);
  expect(riverSuccessor(map, cell)).toBe(water);
  map.WaterKindCodes.set(water, 2);
  expect(riverSuccessor(map, cell)).toBe(water);
  reach.dry = true;
  expect(riverSuccessor(map, cell)).toBe(-1);
});

it("keeps an explicit dry course's successor at an overlap with a running course", () => {
  const map = createTestField(createWorldMesh([0, 0, 10_000, 10_000], 64, 0)),
    cell = map.mesh.cellAt(0, 0),
    runningNext = map.mesh.neighbor(cell, 0),
    dryNext = map.mesh.neighbor(cell, 1),
    running = addReach(map.rivers, [cell, runningNext]),
    dry = addReach(map.rivers, [cell, dryNext]);
  running.monthly.fill(20);
  dry.dry = true;
  expect(riverSuccessor(map, cell)).toBe(runningNext);
  expect(riverSuccessor(map, cell, dry)).toBe(dryNext);
});
