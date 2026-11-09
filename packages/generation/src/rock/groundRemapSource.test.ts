import { expect, it } from "vitest";
import { createTestField } from "./groundTestFixture";
import { createMesh } from "../world/mesh";
import { buildTransportPlan, releaseTransportPlan } from "../world/transportPlan";
import { holdRock, heldLayer, releaseHeldRock } from "./groundTransport";
import { setLayer } from "./rockColumn";
import { rockCatalogue } from "./rockCatalogue";
import { RemapSource } from "./groundRemapSource";

const { basalt, shale } = rockCatalogue;
it("shares transformed donor orientation across reads without changing captured material or history", () => {
  const map = createTestField(createMesh(4, 0));
  setLayer(map, 0, 0, basalt.code, 20, {
    grainX: 1000,
    bedSlopeX: 0.2,
    secondaryKind: shale.code,
    secondaryShare: 0.25,
    damage: 0.3,
    deposited: 2,
    formedMin: 0,
    formedMax: 1,
    altered: 3,
  });
  const held = holdRock(map),
    plan = buildTransportPlan(map, 0);
  plan.deformationXX.set(0, 0);
  plan.deformationXY.set(0, -1);
  plan.deformationYX.set(0, 1);
  plan.deformationYY.set(0, 0);
  const source = new RemapSource(map, held, plan);
  try {
    const first = source.layers(0, "land")[0];
    setLayer(map, 0, 0, shale.code, 30, { altered: 7 });
    const second = source.layers(0, "land")[0];
    expect(first).not.toBe(second);
    expect(second).toMatchObject({
      kind: basalt.code,
      secondaryKind: shale.code,
      secondaryShare: 0.25,
      grainX: -1000,
      bedSlopeX: 0,
      bedSlopeY: 0.2,
      damage: 0.3,
      deposited: 2,
      formedMin: 0,
      formedMax: 1,
      altered: 3,
    });
    expect(heldLayer(held, 0, 0)).toMatchObject({ grainX: 1000, bedSlopeX: 0.2, bedSlopeY: 0 });
  } finally {
    source.close();
    releaseHeldRock(map, held);
    releaseTransportPlan(map, plan);
  }
});

it("keeps occupied beds after an empty slot while empty covers remain empty", () => {
  const map = createTestField(createMesh(4, 0));
  setLayer(map, 0, 2, shale.code, 6, { deposited: 4 }, "cutLoose");
  const held = holdRock(map),
    plan = buildTransportPlan(map, 0),
    source = new RemapSource(map, held, plan);
  try {
    expect(source.layers(0, "loose")).toEqual([]);
    expect(source.layers(0, "land")).toEqual([]);
    expect(source.layers(0, "cutLoose")).toMatchObject([
      { kind: shale.code, depth: 6, deposited: 4 },
    ]);
  } finally {
    source.close();
    releaseHeldRock(map, held);
    releaseTransportPlan(map, plan);
  }
});
