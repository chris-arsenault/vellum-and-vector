import { expect, it } from "vitest";
import { createTestField } from "./groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { units } from "../world/math";
import { setLayer, materialLayer } from "./rockColumn";
import { rockCatalogue as rocks } from "./rockCatalogue";
import { openCut, projectGround } from "./groundShares";
import { groundOf } from "./ground";
import { depositPond } from "./groundDeposition";

function basin() {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  setLayer(map, 0, 0, rocks.granite.code, units(10_000), {}, "land");
  openCut(map, 0, 0.25);
  map.BedrockElevation.set(0, units(95));
  map.GroundCutDepth.set(0, units(20));
  projectGround(map, 0);
  return map;
}
const cargo = materialLayer(rocks.limestone.code, 0, { formedMin: 2, formedMax: 3 }, 2);

it("settled material fills the low facet before burying the intact rim", () => {
  const map = basin(),
    ground = groundOf(map);
  map.CompletedEpochCount = 7;
  depositPond(map, 0, units(2), units(110), "test", "sea", cargo);
  expect(ground.surface(0, "land")).toBe(units(100));
  expect(ground.surface(0, "cut")).toBe(units(88));
  expect(ground.section(0)[0].kind).toBe(rocks.granite.code);
  expect(ground.section(0, "cut")[0]).toMatchObject({
    kind: rocks.limestone.code,
    formedMin: 2,
    formedMax: 3,
    deposited: 7,
    consolidation: 0,
    medium: "loose",
  });
  depositPond(map, 0, units(6), units(110), "test", "sea", cargo);
  expect(ground.surface(0, "land")).toBe(units(103));
  expect(ground.surface(0, "cut")).toBe(units(103));
  expect(ground.section(0)[1].kind).toBe(rocks.granite.code);
});

it("submerged accommodation rejects excess cargo without coating emergent ground", () => {
  const map = basin(),
    ground = groundOf(map);
  const accepted = depositPond(map, 0, units(100), units(90), "test", "sea", cargo);
  expect(accepted).toBe(units(2.5));
  expect(ground.surface(0, "cut")).toBe(units(90));
  expect(ground.surface(0, "land")).toBe(units(100));
  expect(ground.section(0)[0].kind).toBe(rocks.granite.code);
  expect(depositPond(map, 0, units(1), units(90), "test", "sea", cargo)).toBe(0);
});
