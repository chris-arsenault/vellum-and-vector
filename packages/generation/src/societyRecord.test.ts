import { expect, it } from "vitest";
import { decayMaintainedGround, maintenanceRetention } from "./societyRecord";
import { createTestField } from "./rock/groundTestFixture";
import { createWorldMesh } from "./world/worldMesh";

it("ages supplied maintained-ground records by elapsed years without adding tenure or maintenance", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  map.WalkedRoute.set(0, 300);
  map.KeptLine.set(0, 150);
  map.Tenure.set(0, 500);
  decayMaintainedGround(map, 150);
  expect(map.WalkedRoute.get(0)).toBeCloseTo(300 / Math.E);
  expect(map.KeptLine.get(0)).toBeCloseTo(150 / Math.E);
  expect(map.Tenure.get(0)).toBe(500);
  decayMaintainedGround(map, 0);
  expect(map.WalkedRoute.get(0)).toBeCloseTo(300 / Math.E);
  expect(maintenanceRetention(300)).toBeCloseTo(Math.exp(-2));
});
