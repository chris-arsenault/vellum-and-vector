import { expect, it } from "vitest";
import { createTestField } from "../rock/groundTestFixture";
import { workingArray } from "../world/physicalNumerics";
import { weightScale, type TransportPlan } from "../world/transportPlan";
import { createWorldMesh } from "../world/worldMesh";
import { addReach } from "./reachEvolution";
import { carryRiverGround } from "./reachTransport";

it("carries named dry and former courses with their ground and retained bed samples", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0)),
    count = map.mesh.count,
    plan = {
      offsets: workingArray(map, "int32", "test:offsets", count + 1),
      targets: workingArray(map, "int32", "test:targets"),
      weights: workingArray(map, "float64", "test:weights"),
    };
  for (let cell = 0; cell < count; cell++) {
    plan.offsets.set(cell, cell);
    plan.targets.set(cell, (cell + 1) % count);
    plan.weights.set(cell, weightScale);
  }
  plan.offsets.set(count, count);
  const reach = addReach(map.rivers, [1, 2, 3]);
  reach.river = "old-river";
  reach.name = "Old River";
  reach.dry = true;
  reach.former = [{ cells: [4, 5], leftIn: 1 }];
  reach.bed.set([9, 7, 6]);
  carryRiverGround(map, plan as TransportPlan);
  expect(map.rivers.reaches.get(reach.id)).toBe(reach);
  expect(reach.cells).toEqual([2, 3, 4]);
  expect(reach.former).toEqual([{ cells: [5, 6], leftIn: 1 }]);
  expect(Array.from(reach.bed)).toEqual([9, 7, 6]);
  expect(reach.name).toBe("Old River");
  expect(reach.dry).toBe(true);
});
