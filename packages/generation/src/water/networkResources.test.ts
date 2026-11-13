import { expect, it } from "vitest";
import { createTestField } from "../rock/groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { addReach } from "./reachEvolution";
import { captureRivers, restoreRivers } from "./networkResources";

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
