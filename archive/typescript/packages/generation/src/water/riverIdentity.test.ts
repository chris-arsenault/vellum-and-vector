import { expect, expectTypeOf, it } from "vitest";
import { createTestField } from "../rock/groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { addReach } from "./reachEvolution";
import { associateRiverPublication } from "./riverKeeping";
import { establishRiverIdentities, markDrawnReaches } from "./riverVisibility";
import type { PhysicalField } from "../world/field";
import type { ReachView, RiverProfile } from "./reaches";

it("exposes retained river state through read-only contracts", () => {
  expectTypeOf<PhysicalField["rivers"]["reaches"]>().toEqualTypeOf<
    ReadonlyMap<number, ReachView>
  >();
  expectTypeOf<Pick<ReachView, "drawn">>().toEqualTypeOf<{ readonly drawn: boolean }>();
  expectTypeOf<ReachView["monthly"]>().toEqualTypeOf<RiverProfile>();
  expectTypeOf<RiverProfile>().not.toHaveProperty("set");
});

function supplied() {
  const map = createTestField(createWorldMesh([100, 200, 1_000_100, 1_000_200], 16, 0)),
    reach = addReach(map.rivers, [1, 2]);
  map.FlowTargets.set(1, 2);
  map.FlowTargets.set(2, -1);
  reach.monthly.fill(1000);
  reach.catchment.fill(50e9);
  map.CatchmentArea.fill(50e9);
  return { map, reach };
}

it("keeps significance reads separate from explicit identity establishment", () => {
  const { map, reach } = supplied();
  markDrawnReaches(map);
  expect(reach.river).toBeUndefined();
  establishRiverIdentities(map);
  expect(reach.river).toMatch(/^river:/);
  expect(reach.record).toBe(`river:${reach.river}:0`);
});

it("preserves imported river identities and accepts only publication metadata", () => {
  const { map, reach } = supplied();
  reach.river = "river:300.000000:400.000000:200.000000:400.000000";
  reach.drawn = true;
  establishRiverIdentities(map);
  const identity = reach.river;
  associateRiverPublication(map, identity, { record: "published-key", name: "River Name" });
  expect(reach.river).toBe(identity);
  expect(reach.record).toBe("published-key");
  expect(reach.name).toBe("River Name");
  expect(reach.cells).toEqual([1, 2]);
  expect(reach.drawn).toBe(true);
  expect(reach.monthly[0]).toBe(1000);
  associateRiverPublication(map, "unestablished-river", { name: "No River" });
  expect(map.rivers.reaches.size).toBe(1);
  expect(reach.river).toBe(identity);
});
