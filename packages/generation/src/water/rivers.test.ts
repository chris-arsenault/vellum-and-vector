import { expect, it } from "vitest";
import { MapScale } from "@atlas/domain";
import "../coupling/responders";
import { createTestField } from "../rock/groundTestFixture";
import { atlasPhysicalProfile } from "../world/atlasProfile";
import { physicalContext } from "../world/context";
import { depthRateToDischarge } from "../world/dimensions";
import { workingArray } from "../world/physicalNumerics";
import { createWorldMesh } from "../world/worldMesh";
import { sourceToOutletOrder } from "../world/flowGraph";
import { gatherYear } from "./rivers";
import { waterAccount } from "./waterLedger";

const secondsPerYear = 365.25 * 24 * 3600;

function land() {
  const map = createTestField(createWorldMesh([0, 0, 10_000, 10_000], 16, 0)),
    context = physicalContext(1, 0, atlasPhysicalProfile({}, {}, MapScale.reference()));
  map.WaterKindCodes.fill(0);
  map.FlowTargets.fill(-1);
  map.LakeOutletTargets.fill(-1);
  return { map, context };
}

it("accounts for all the water rivers are given: what goes in comes out or is recorded lost", () => {
  const { map, context } = land(),
    incoming = workingArray(map, "float64", "test:incoming");
  // A chain to the sea, with a river entering at its head; every other cell drains nowhere.
  const chain = [0];
  while (chain.length < 4) {
    const at = chain[chain.length - 1];
    let next = -1;
    for (let edge = 0; edge < map.mesh.degree(at) && next < 0; edge++) {
      const j = map.mesh.neighbor(at, edge);
      if (j >= 0 && !chain.includes(j)) next = j;
    }
    map.FlowTargets.set(at, next);
    chain.push(next);
  }
  map.WaterKindCodes.set(chain[3], 1);
  map.Runoff.fill(400);
  map.Runoff.set(chain[3], 0);
  incoming.set(0, 5);
  gatherYear(map, context, sourceToOutletOrder(map), incoming);
  let given = 5 * secondsPerYear;
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes.get(i) === 0)
      given += depthRateToDischarge(400, map.mesh.area(i)) * secondsPerYear;
  const { moves } = waterAccount(map),
    of = (cause: string) => moves.find((move) => move.cause === cause)?.volume ?? 0,
    out = of("mouth") + of("leaving") + of("pan") + of("bedLoss") + of("withdrawal") + of("inflow");
  expect(of("entering")).toBeCloseTo(5 * secondsPerYear, 0);
  expect(of("mouth")).toBeGreaterThan(0);
  expect(out / given).toBeCloseTo(1, 6);
});
