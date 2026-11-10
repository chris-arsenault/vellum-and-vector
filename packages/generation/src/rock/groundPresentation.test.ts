import { expect, it } from "vitest";
import { exposedMaterialCode, surfaceMaterialCode, surfaceWaterCode } from "./groundPresentation";
import { rockCatalogue as rocks } from "./rockCatalogue";
import { materialLayer, setLayer } from "./rockColumn";
import { createTestField } from "./groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { openCut, projectGround } from "./groundShares";

const material = (kind: number, share = 1) => ({ ...materialLayer(kind, 30), share });

it("presents loose cover instead of the magical bed beneath it", () => {
  expect(
    exposedMaterialCode([[material(rocks.alluvium.code), material(rocks.keptStone.code)]])
  ).toBe(rocks.alluvium.code);
  expect(exposedMaterialCode([[material(rocks.keptStone.code)]])).toBe(rocks.keptStone.code);
});

it("combines exposed constituents across occupied facets before choosing a category", () => {
  const mixed = {
    ...material(rocks.granite.code, 0.6),
    secondaryKind: rocks.crushstone.code,
    secondaryShare: 0.4,
  };
  expect(exposedMaterialCode([[mixed], [material(rocks.crushstone.code, 0.4)]])).toBe(
    rocks.crushstone.code
  );
});

it("thin soil leaves substrate readable while a full soil skin, water and ice hide it", () => {
  const section = [[material(rocks.rootstone.code)]];
  expect(exposedMaterialCode(section, 0.1)).toBe(rocks.rootstone.code);
  expect(exposedMaterialCode(section, 0.8)).toBe(rocks.soil.code);
  expect(exposedMaterialCode(section, 0, true)).toBe(surfaceWaterCode);
  expect(exposedMaterialCode(section, 0, true, true)).toBe(rocks.glacierIce.code);
});

it("the production projection reads retained cover and the existing Ground soil share", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  setLayer(map, 0, 0, rocks.rootstone.code, 100);
  openCut(map, 0, 0.2);
  setLayer(map, 0, 0, rocks.shale.code, 10, {}, "loose");
  projectGround(map, 0);
  map.WaterKindCodes.set(0, 0);
  expect(surfaceMaterialCode(map, 0)).toBe(rocks.shale.code);
  map.SoilDepth.set(0, map.scale.length(0.00000025));
  expect(surfaceMaterialCode(map, 0)).toBe(rocks.soil.code);
  map.IceThickness.set(0, 1);
  expect(surfaceMaterialCode(map, 0)).toBe(rocks.glacierIce.code);
});
