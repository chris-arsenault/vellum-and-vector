import { expect, it } from "vitest";
import { createTestField } from "../rock/groundTestFixture";
import { units } from "../world/math";
import { workingArray } from "../world/physicalNumerics";
import { weightScale, type TransportPlan } from "../world/transportPlan";
import { createWorldMesh } from "../world/worldMesh";
import {
  carryColumn,
  putGroundwater,
  putSnow,
  putSoilWater,
  standWater,
  waterColumnChannels,
} from "./column";

/** A small field, and a plate move that swaps the ground of cells 0 and 1 and leaves the rest. */
function swapped() {
  const map = createTestField(createWorldMesh([0, 0, 10_000, 10_000], 16, 0)),
    count = map.mesh.count,
    goesTo = (cell: number) => (cell === 0 ? 1 : cell === 1 ? 0 : cell),
    plan = {
      offsets: workingArray(map, "int32", "test:offsets", count + 1),
      targets: workingArray(map, "int32", "test:targets"),
      weights: workingArray(map, "float64", "test:weights"),
      dominant: workingArray(map, "int32", "test:dominant"),
    };
  for (let cell = 0; cell < count; cell++) {
    plan.offsets.set(cell, cell);
    plan.targets.set(cell, goesTo(cell));
    plan.weights.set(cell, weightScale);
    plan.dominant.set(goesTo(cell), cell);
    map.Elevation.set(cell, units(100));
  }
  plan.offsets.set(count, count);
  map.WaterKindCodes.fill(0);
  return { map, plan: plan as unknown as TransportPlan };
}

it("moves the water a cell holds with its ground when the plates move", () => {
  const { map, plan } = swapped();
  putSnow(map, 0, 0.3);
  putSoilWater(map, 0, 0.2);
  putGroundwater(map, 0, 5);
  putGroundwater(map, 2, 1);
  carryColumn(map, plan);
  expect(map.SnowPack.get(1)).toBeCloseTo(0.3, 9);
  expect(map.SoilWater.get(1)).toBeCloseTo(0.2, 9);
  expect(map.GroundwaterStorage.get(1)).toBeCloseTo(5, 9);
  // The ground that came the other way brought none.
  expect(map.SnowPack.get(0)).toBe(0);
  expect(map.GroundwaterStorage.get(0)).toBe(0);
  // Ground that did not move keeps what it held.
  expect(map.GroundwaterStorage.get(2)).toBeCloseTo(1, 9);
});

it("moves a lake with the ground it lies on, and leaves the sea where it is", () => {
  const { map, plan } = swapped();
  standWater(map, 0, 2, units(120), 7);
  standWater(map, 3, 1, units(110), 1);
  carryColumn(map, plan);
  expect(map.WaterKindCodes.get(1)).toBe(2);
  expect(map.WaterBodyIds.get(1)).toBe(7);
  expect(map.WaterSurfaceElevations.get(1)).toBe(units(120));
  expect(map.WaterDepths.get(1)).toBe(units(20));
  // The cell the lake's ground left is land again.
  expect(map.WaterKindCodes.get(0)).toBe(0);
  expect(map.WaterDepths.get(0)).toBe(0);
  // The sea did not move.
  expect(map.WaterKindCodes.get(3)).toBe(1);
});

it("hands a finer map every part of the column together", () => {
  expect(waterColumnChannels.map(({ name }) => name)).toEqual([
    "SnowPack",
    "SoilWater",
    "GroundwaterStorage",
    "WaterDepths",
    "WaterSurfaceElevations",
    "WaterKindCodes",
    "WaterBodyIds",
  ]);
});
