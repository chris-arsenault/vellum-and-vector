import { expect, it } from "vitest";
import { createTestField } from "../rock/groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { addReach } from "./reachEvolution";
import { captureRivers, restoreRivers } from "./networkResources";
import { retainedRiverTrace } from "@atlas/domain";

it("a detached map capture retains named dry rivers and their former courses", () => {
  const mesh = createWorldMesh([0, 0, 10_000, 10_000], 16, 0),
    map = createTestField(mesh),
    reopened = createTestField(mesh);
  const reach = addReach(map.rivers, [1, 2, 3]);
  reach.river = "long-river";
  reach.former = [{ cells: [4, 5], leftIn: 1 }];
  reach.dry = true;
  const saved = captureRivers(map);
  restoreRivers(reopened, saved);
  const restored = reopened.rivers.reaches.get(1)!;
  expect(restored.cells).toEqual([1, 2, 3]);
  expect(restored.river).toBe("long-river");
  expect(restored.former).toEqual([{ cells: [4, 5], leftIn: 1 }]);
  expect(restored.dry).toBe(true);
  restored.monthly[0] = 99;
  expect(saved.reaches[0].monthly[0]).toBe(0);
});

it("captures only real receiving edges while keeping raw one-cell profiles", () => {
  const mesh = createWorldMesh([0, 0, 10_000, 10_000], 64, 0),
    map = createTestField(mesh),
    cell = mesh.cellAt(5000 - mesh.origin[0], 5000 - mesh.origin[1]),
    next = mesh.neighbor(cell, 0),
    upper = addReach(map.rivers, [cell]),
    lower = addReach(map.rivers, [next]);
  upper.downstream = lower.id;
  upper.monthly.fill(20);
  upper.catchment[0] = 900;
  const saved = captureRivers(map),
    record = saved.reaches.find((reach) => reach.id === upper.id)!;
  expect(record.course).toHaveLength(1);
  expect(record.monthly).toHaveLength(12);
  expect(record.catchment).toEqual([900]);
  expect(record.junction).toEqual([mesh.x(next) + mesh.origin[0], mesh.y(next) + mesh.origin[1]]);
  expect(retainedRiverTrace(record)?.sampleIndices).toEqual([0, 0]);
  const reopened = createTestField(mesh);
  restoreRivers(reopened, saved);
  expect(reopened.rivers.reaches.get(upper.id)).not.toHaveProperty("junction");
  lower.cells = [mesh.cellAt(9000 - mesh.origin[0], 9000 - mesh.origin[1])];
  expect(
    captureRivers(map).reaches.find((reach) => reach.id === upper.id)?.junction
  ).toBeUndefined();
});
