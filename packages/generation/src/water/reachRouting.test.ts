import { expect, it } from "vitest";
import { createTestField } from "../rock/groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { addReach } from "./reachEvolution";
import { retainRiverRoutes } from "./reachRouting";

it("uses the same viable retained edge for erosion reads and water routing", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0)),
    from = 0,
    to = map.mesh.neighbor(from, 0),
    proposed = map.coverage.copyBand(map.FlowTargets).fill(-1);
  addReach(map.rivers, [from, to]);
  map.DrainageElevations.set(from, 100);
  map.DrainageElevations.set(to, 90);
  retainRiverRoutes(map, proposed);
  expect(proposed.get(from)).toBe(to);
  expect(map.FlowTargets.get(from)).toBe(-1);
  retainRiverRoutes(map);
  expect(map.FlowTargets.get(from)).toBe(to);
  // Changed ground releases the old edge rather than pinning a remembered course.
  map.DrainageElevations.set(to, 110);
  proposed.fill(-1);
  retainRiverRoutes(map, proposed);
  expect(proposed.get(from)).toBe(-1);
});
