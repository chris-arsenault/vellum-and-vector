import { expect, it, vi } from "vitest";
import { MapScale } from "@atlas/domain";
import { ask, respond } from "../coupling/answers";
import { invalidateProcesses } from "../processOperation";
import "../coupling/responders";
import { createTestField } from "../rock/groundTestFixture";
import { atlasPhysicalProfile } from "../world/atlasProfile";
import { physicalContext } from "../world/context";
import { createWorldMesh } from "../world/worldMesh";
import { passingWater, referenceWaterPassage, waterPassage } from "./waterQuantity";
import { depthRateToDischarge, releasedWaterRate } from "../world/dimensions";
import type { PhysicalField } from "../world/field";
import { beginGroundwaterExchange, groundwaterCapacity } from "./groundwater";

const extraSupply = new WeakMap<PhysicalField, number>(),
  intake = new WeakMap<PhysicalField, number>(),
  passage = new WeakMap<PhysicalField, number>();
const contributor = vi.fn((map: PhysicalField) => extraSupply.get(map) ?? 0);
respond({ key: "surfaceWater", by: "supplied test inlet", reads: [], add: contributor });
respond({
  key: "waterWithdrawal",
  by: "supplied test intake",
  reads: [],
  add: (map) => intake.get(map) ?? 0,
});
respond({
  key: "waterTransmission",
  by: "supplied test sink",
  reads: [],
  scale: (map) => passage.get(map) ?? 1,
});

function supplied() {
  const map = createTestField(createWorldMesh([0, 0, 10_000, 10_000], 16, 0)),
    context = physicalContext(1, 0, atlasPhysicalProfile({}, {}, MapScale.reference()));
  map.WaterKindCodes.fill(0);
  return { map, context: { ...context, HydrologyStrength: 500 } };
}

it("normalizes an actual water receipt at its producing interval", () => {
  expect(releasedWaterRate(3, 0.5)).toBe(6);
  expect(releasedWaterRate(3, 2)).toBe(1.5);
  expect(releasedWaterRate(0, 0)).toBe(0);
});

it("composes rain, melt and returned groundwater once for routing and incision", () => {
  const { map, context } = supplied();
  map.Runoff.set(0, 100);
  map.GlacialMeltwater.set(0, 50);
  beginGroundwaterExchange(map, 0.5);
  map.GroundwaterReturn.set(0, 0.01);
  const supply = ask(map, "surfaceWater", context).get(0);
  expect(supply).toBeCloseTo(170);
  expect(
    ask(map, "discharge", context).get(0) * context.Profile.FluvialReferenceRunoff
  ).toBeCloseTo(supply);
  expect(map.Runoff.get(0)).toBe(100);
  expect(map.GroundwaterReturn.get(0)).toBe(0.01);
  map.Runoff.set(0, 200);
  invalidateProcesses(map);
  expect(ask(map, "surfaceWater", context).get(0)).toBeCloseTo(270);
  beginGroundwaterExchange(map, 0);
  invalidateProcesses(map);
  expect(ask(map, "surfaceWater", context).get(0)).toBeCloseTo(250);
});

it("a contributor extends the quantity without changing either consumer", () => {
  const { map, context } = supplied();
  map.Runoff.fill(100);
  extraSupply.set(map, 40);
  contributor.mockClear();
  expect(ask(map, "surfaceWater", context).get(0)).toBe(140);
  expect(
    ask(map, "discharge", context).get(0) * context.Profile.FluvialReferenceRunoff
  ).toBeCloseTo(140);
  expect(contributor).toHaveBeenCalledTimes(map.mesh.count);
  extraSupply.set(map, 70);
  invalidateProcesses(map);
  expect(
    ask(map, "discharge", context).get(0) * context.Profile.FluvialReferenceRunoff
  ).toBeCloseTo(170);
  expect(ask(map, "surfaceWater", context).get(0)).toBe(170);
});

it("routing and erosion apply the same maintained loss to available incoming water", () => {
  const { map, context } = supplied();
  // Ground already full takes nothing through the bed, so only the maintained loss acts.
  for (let i = 0; i < map.mesh.count; i++)
    map.GroundwaterStorage.set(i, groundwaterCapacity(map, i));
  intake.set(map, 4);
  passage.set(map, 0.5);
  expect(waterPassage(map, context)(0, 14)).toBe(5);
  const unit = depthRateToDischarge(context.Profile.FluvialReferenceRunoff, 1);
  expect(referenceWaterPassage(map, context)(0, 14 / unit) * unit).toBeCloseTo(5);
  passage.set(map, 0);
  invalidateProcesses(map);
  expect(waterPassage(map, context)(0, 14)).toBe(0);
  expect(passingWater(2, 4, 1)).toBe(0);
});
