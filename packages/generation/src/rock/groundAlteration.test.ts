import { expect, it } from "vitest";
import { alterGround, alterMaterialInterval } from "./groundAlteration";
import { materialLayer, readLayer, setLayer, type MaterialLayer } from "./rockColumn";
import { rockCatalogue as rocks } from "./rockCatalogue";
import { createTestField } from "./groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { openCut, projectGround } from "./groundShares";

const weaken = (layer: Readonly<MaterialLayer>): MaterialLayer => ({
  ...layer,
  kind: rocks.crushstone.code,
  secondaryKind: rocks.crushstone.code,
  secondaryShare: 0,
  strength: rocks.crushstone.resistance,
  altered: 9,
});

it("splits reached beds without flattening their separate ages and fabric", () => {
  const upper = materialLayer(rocks.limestone.code, 20, { grainX: 0.7, deposited: 4 }, 2),
    lower = materialLayer(rocks.granite.code, 50, { bedSlopeY: -0.4 }, 1),
    result = alterMaterialInterval([upper, lower], 12, 35, weaken, true);
  expect(result).toEqual([
    { ...upper, depth: 12 },
    { ...weaken(upper), depth: 8 },
    { ...weaken(lower), depth: 15 },
    { ...lower, depth: 35 },
  ]);
});

it("reaches into unbounded basement without turning all deeper rock into the altered kind", () => {
  const basement = materialLayer(rocks.gneiss.code, 1, { formedMin: 3, bedSlopeX: 0.2 }),
    result = alterMaterialInterval([basement], 30, 45, weaken, true);
  expect(result).toEqual([
    { ...basement, depth: 30 },
    { ...weaken(basement), depth: 15 },
    basement,
  ]);
});

it("finite deposits stop at their bottom and an unchanged response creates no contacts", () => {
  const deposit = materialLayer(rocks.sandstone.code, 12, {}, 4);
  expect(alterMaterialInterval([deposit], 4, 40, weaken)).toEqual([
    { ...deposit, depth: 4 },
    { ...weaken(deposit), depth: 8 },
  ]);
  expect(alterMaterialInterval([deposit], 4, 8, (layer) => layer)).toEqual([deposit]);
  expect(alterMaterialInterval([deposit], 13, 40, weaken)).toEqual([deposit]);
});

function suppliedGround() {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  map.BedrockElevation.set(0, 1000);
  setLayer(map, 0, 0, rocks.granite.code, 100, { formedMin: 2 });
  openCut(map, 0, 0.25);
  setLayer(map, 0, 0, rocks.shale.code, 20, { formedMin: 4 }, "loose");
  setLayer(map, 0, 0, rocks.sandstone.code, 5, { formedMin: 5 }, "cutLoose");
  projectGround(map, 0);
  return map;
}

it("surface reach spends each facet's cover before altering its rock", () => {
  const map = suppliedGround(),
    height = map.Elevation.get(0);
  alterGround(map, 0, { depth: 10, transform: weaken });
  expect(readLayer(map, 0, 0, "loose")).toMatchObject({
    kind: rocks.crushstone.code,
    depth: 10,
    formedMin: 4,
  });
  expect(readLayer(map, 0, 1, "loose")).toMatchObject({ kind: rocks.shale.code, depth: 10 });
  expect(readLayer(map, 0, 0)).toMatchObject({ kind: rocks.granite.code, depth: 100 });
  expect(readLayer(map, 0, 0, "cut")).toMatchObject({
    kind: rocks.crushstone.code,
    depth: 5,
    formedMin: 2,
  });
  expect(readLayer(map, 0, 1, "cut")).toMatchObject({ kind: rocks.granite.code });
  expect(map.Elevation.get(0)).toBe(height);
  expect(map.BedrockElevation.get(0)).toBe(1000);
});

it("subsurface reach changes only its interval beneath the selected facet", () => {
  const map = suppliedGround();
  alterGround(map, 0, { from: "rock", offset: 15, depth: 10, facet: "land", transform: weaken });
  expect(readLayer(map, 0, 0)).toMatchObject({ kind: rocks.granite.code, depth: 15 });
  expect(readLayer(map, 0, 1)).toMatchObject({
    kind: rocks.crushstone.code,
    depth: 10,
    formedMin: 2,
  });
  expect(readLayer(map, 0, 2)).toMatchObject({ kind: rocks.granite.code, depth: 75 });
  expect(readLayer(map, 0, 0, "loose")).toMatchObject({ kind: rocks.shale.code, depth: 20 });
  expect(readLayer(map, 0, 0, "cut")).toMatchObject({ kind: rocks.granite.code, depth: 100 });
});

it("a surface offset crosses cover and reaches the actual bed rather than a slot number", () => {
  const map = suppliedGround();
  alterGround(map, 0, { offset: 25, depth: 10, facet: "land", transform: weaken });
  expect(readLayer(map, 0, 0, "loose")).toMatchObject({ kind: rocks.shale.code, depth: 20 });
  expect(readLayer(map, 0, 0)).toMatchObject({ kind: rocks.granite.code, depth: 5 });
  expect(readLayer(map, 0, 1)).toMatchObject({ kind: rocks.crushstone.code, depth: 10 });
});
