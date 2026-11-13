import { expect, it } from "vitest";
import { MapScale } from "@atlas/domain";
import { ask } from "../coupling/answers";
import "../coupling/responders";
import { runOperation } from "../processOperation";
import { createTestField } from "../rock/groundTestFixture";
import { atlasPhysicalProfile } from "../world/atlasProfile";
import { physicalContext } from "../world/context";
import { units } from "../world/math";
import { createWorldMesh } from "../world/worldMesh";
import { layHumanLayer } from "./layerOperations";
import { travelStep } from "./travel";
import { addReach } from "../water/reachEvolution";

const context = () => physicalContext(1, 0, atlasPhysicalProfile({}, {}, MapScale.reference()));
/** Warm, watered, deep-soiled open ground with a little grass and wood on every cell. */
function fertile() {
  const map = createTestField(createWorldMesh([0, 0, 1_000_000, 1_000_000], 16, 0));
  for (let i = 0; i < map.mesh.count; i++) {
    map.Temperature.set(i, 480);
    map.Moisture.set(i, 800);
    map.SoilDepth.set(i, map.scale.length(1.25e-7));
    map.GrassCover.set(i, 0.5);
    map.TreeCover.set(i, 0.2);
    map.Productivity.set(i, 0.5);
  }
  return map;
}
const neighbour = (map: ReturnType<typeof fertile>, cell: number) => {
  for (let edge = 0; edge < map.mesh.degree(cell); edge++)
    if (map.mesh.neighbor(cell, edge) >= 0) return map.mesh.neighbor(cell, edge);
  throw new Error("The fixture cell has a neighbour.");
};

it("feeds more people where the ground is put under crops", () => {
  const map = fertile(),
    c = context(),
    wild = ask(map, "support", c).get(0);
  expect(wild).toBeCloseTo(ask(map, "wildYield", c).get(0));
  runOperation(map, layHumanLayer, { map, kind: "farmland", amount: { get: () => 0.5 } });
  const farmed = ask(map, "support", c).get(0);
  expect(farmed).toBeCloseTo(
    0.5 * ask(map, "cropYield", c).get(0) + 0.5 * ask(map, "wildYield", c).get(0)
  );
  expect(farmed).toBeGreaterThan(wild);
});
it("feeds nobody on water or under thick ice", () => {
  const map = fertile(),
    c = context();
  map.WaterKindCodes.set(0, 1);
  map.IceThickness.set(1, map.scale.length(0.00025));
  for (const key of ["cropYield", "herdYield", "wildYield", "support"] as const) {
    expect(ask(map, key, c).get(0), key).toBe(0);
    expect(ask(map, key, c).get(1), key).toBe(0);
    expect(ask(map, key, c).get(2), key).toBeGreaterThan(0);
  }
});
it("makes a worn way and a river easier going than woods", () => {
  const map = fertile(),
    c = context();
  map.WalkedRoute.set(1, 1e9);
  const reach = addReach(map.rivers, [2]);
  reach.drawn = true;
  reach.monthly.fill(20);
  const friction = ask(map, "travelFriction", c);
  expect(friction.get(0)).toBeCloseTo(1.2);
  expect(friction.get(1)).toBeCloseTo(0.6);
  expect(friction.get(2)).toBe(0.5);
});
it("charges a climb, refuses a cliff, and charges the launch onto water", () => {
  const map = fertile(),
    c = context(),
    from = 0,
    to = neighbour(map, from),
    level = travelStep(map, ask(map, "travelFriction", c))(from, to);
  map.Elevation.set(to, units(100));
  const climb = travelStep(map, ask(map, "travelFriction", c))(from, to);
  expect(climb - level).toBeCloseTo(3000);
  map.Elevation.set(to, units(1_000_000));
  expect(travelStep(map, ask(map, "travelFriction", c))(from, to)).toBe(Infinity);
  map.WaterKindCodes.set(to, 1);
  const friction = ask(map, "travelFriction", c),
    step = travelStep(map, friction);
  expect(step(from, to)).toBeGreaterThan(map.scale.length(0.0025));
  expect(step(from, to)).toBe(step(to, from));
});
