import { expect, it } from "vitest";
import { faultDisplacement } from "./orogenicShape";
import { loadedPlane, resolvedLoading } from "./reactivation";
import { createTestField } from "../rock/groundTestFixture";
import { createWorldMesh } from "./worldMesh";
import { units } from "./math";
import { readLayer, setLayer } from "../rock/rockColumn";
import { groundOf } from "../rock/ground";
import { yieldingPlane } from "../rock/groundQueries";
import { projectGround } from "../rock/groundShares";
import { rockCatalogue as rocks } from "../rock/rockCatalogue";
import { deformationCost } from "./orogenicComponents";

it("resolves the same load differently against inherited crossing fabrics", () => {
  expect(resolvedLoading(1, 0, 0, 1000, 0)).toBe(0);
  expect(resolvedLoading(1, 0, 0, -1000, 0)).toBeCloseTo(1);
  expect(resolvedLoading(0, 0, 1, 1000, 0)).toBeCloseTo(1);
  expect(resolvedLoading(0, 0, 1, -1000, 0)).toBeCloseTo(0);
  expect(resolvedLoading(-1, 0, 0, -1000, 0)).toBeCloseTo(-1);
  expect(resolvedLoading(1, 0, 0, 0, 0)).toBe(0.5);
  expect(resolvedLoading(0, 0, 0, 500, 500)).toBe(0);
});

it("keeps fault polarity from existing dip while opening and closure reverse displacement", () => {
  const opening = faultDisplacement(10, 1, 2, 0.1),
    closing = faultDisplacement(-10, 1, 2, 0.1);
  expect(opening[0]).toBeLessThan(0);
  expect(opening[1]).toBeGreaterThan(0);
  expect(closing[0]).toBeGreaterThan(0);
  expect(closing[1]).toBeLessThan(0);
  expect(faultDisplacement(10, 1, 2, -0.1)[0]).toBeGreaterThan(0);
  expect(faultDisplacement(0, 1, 2, 0.1)).toEqual([0, 0]);
});

it("localizes new slip by material compliance without assigning alternating block indices", () => {
  expect(faultDisplacement(10, 2, 1, 0)[0]).toBeLessThan(0);
  expect(faultDisplacement(10, 1, 2, 0)[1]).toBeLessThan(0);
  expect(faultDisplacement(10, 1, 1, 0)).toEqual([0, 0]);
  const strong = faultDisplacement(10, 0.1, 0.1, 0.1),
    weak = faultDisplacement(10, 1, 1, 0.1);
  expect(Math.abs(strong[0])).toBeLessThan(Math.abs(weak[0]));
});

function buriedSeam() {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  setLayer(map, 0, 0, rocks.basalt.code, units(100), { strength: 5000 });
  setLayer(map, 0, 1, rocks.shale.code, units(100), {
    strength: 100,
    grainX: -1000,
    bedSlopeX: 0.4,
  });
  setLayer(map, 0, 2, rocks.granite.code, units(10_000), { strength: 5000 });
  projectGround(map, 0);
  return map;
}

it("a flat strong cap preserves the buried weak bed's loading direction and fault dip", () => {
  const map = buriedSeam(),
    ground = groundOf(map),
    engaged = ground.fold(0, loadedPlane(1, 0, 0));
  expect(map.StructuralGrainX.get(0)).toBe(0);
  expect(ground.fold(0, yieldingPlane()).slopeX).toBe(0.4);
  expect(engaged.slopeX).toBe(0.4);
  setLayer(map, 0, 1, rocks.shale.code, units(100), { ...readLayer(map, 0, 1), grainX: 1000 });
  const crossed = ground.fold(0, loadedPlane(1, 0, 0));
  expect(crossed.response).toBeLessThan(engaged.response);
  expect(ground.section(0)[0].kind).toBe(rocks.basalt.code);
});

it("an unengaged weak bed does not hide a stronger bed aligned to the load", () => {
  const map = buriedSeam(),
    ground = groundOf(map);
  setLayer(map, 0, 1, rocks.shale.code, units(100), { ...readLayer(map, 0, 1), grainX: 1000 });
  setLayer(map, 0, 2, rocks.limestone.code, units(200), {
    strength: 300,
    grainX: -1000,
    bedSlopeX: -0.2,
  });
  setLayer(map, 0, 3, rocks.granite.code, units(10_000), { strength: 5000 });
  const response = ground.fold(0, loadedPlane(1, 0, 0));
  expect(response.response).toBeGreaterThan(0);
  expect(response.slopeX).toBe(-0.2);
  expect(ground.fold(0, loadedPlane(-1, 0, 0)).response).toBeLessThan(0);
});

it("spends finite shortening work on resistance and the retained wedge instead of a fixed belt radius", () => {
  const weak = deformationCost(100, 2, 0),
    strong = deformationCost(100, 0.5, 0),
    loaded = deformationCost(100, 2, 1);
  expect(weak).toBeLessThan(75);
  expect(strong).toBeGreaterThan(75);
  expect(loaded).toBeGreaterThan(75);
  expect(deformationCost(100, 0, 0)).toBe(Infinity);
  expect(deformationCost(1000, 2, 0)).toBeGreaterThan(75);
});
