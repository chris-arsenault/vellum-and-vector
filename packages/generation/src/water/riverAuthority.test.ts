import { expect, it } from "vitest";
import { createTestField } from "../rock/groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { addReach } from "./reachEvolution";
import { onRiver, riverOrderAt, riverOrders, riverSample, waterAt } from "./riverKeeping";
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
