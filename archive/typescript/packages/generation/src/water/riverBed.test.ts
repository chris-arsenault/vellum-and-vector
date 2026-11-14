import { expect, it } from "vitest";
import { createTestField } from "../rock/groundTestFixture";
import { openCut, moveFacet, projectGround } from "../rock/groundShares";
import { setLayer } from "../rock/rockColumn";
import { rockCatalogue as rocks } from "../rock/rockCatalogue";
import { createWorldMesh } from "../world/worldMesh";
import { units } from "../world/math";
import { addReach } from "./reachEvolution";
import { drainageBed } from "./riverBed";

it("reads the physical valley floor before and after a river resolves there", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  map.BedrockElevation.set(0, units(100));
  setLayer(map, 0, 0, rocks.quartzite.code, units(200));
  openCut(map, 0, 0.25);
  moveFacet(map, 0, "cut", -units(40));
  projectGround(map, 0);
  expect(drainageBed(map, 0)).toBe(units(60));
  const reach = addReach(map.rivers, [0]);
  reach.bed[0] = units(20);
  map.rivers.at = undefined;
  expect(drainageBed(map, 0)).toBe(units(60));
  // Actual infill changes the floor; a remembered bed cannot lock the ground in place.
  moveFacet(map, 0, "cut", units(20));
  projectGround(map, 0);
  expect(drainageBed(map, 0)).toBe(units(80));
});

it("keeps the actual drainage floor when water stands in the valley", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  map.BedrockElevation.set(0, units(100));
  setLayer(map, 0, 0, rocks.quartzite.code, units(200));
  openCut(map, 0, 0.25);
  moveFacet(map, 0, "cut", -units(40));
  projectGround(map, 0);

  expect(drainageBed(map, 0)).toBe(units(60));
  map.WaterKindCodes.set(0, 2);
  expect(drainageBed(map, 0)).toBe(units(60));

  map.WaterKindCodes.set(0, 1);
  expect(drainageBed(map, 0)).toBe(map.Elevation.get(0));
});
