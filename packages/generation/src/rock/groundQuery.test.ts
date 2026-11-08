import { expect, it } from "vitest";
import { createTestField } from "./groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { units } from "../world/math";
import { groundOf } from "./ground";
import { averageGroundQuery, groundFact, materialFact, type GroundQuery } from "./groundQuery";
import { surfaceKind, surfacePorosity, surfaceResistance } from "./groundQueries";
import { rockCatalogue as rocks } from "./rockCatalogue";
import { setLayer } from "./rockColumn";
import { openCut, projectGround } from "./groundShares";
import { removeRock } from "./groundLedger";

function mixedGround() {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  setLayer(map, 0, 0, rocks.sandstone.code, units(4), {
    secondaryKind: rocks.shale.code,
    secondaryShare: 0.25,
    strength: 900,
    damage: 0.4,
    grainX: 0.6,
    grainY: 0.8,
    formedMin: 2,
    formedMax: 5,
  });
  setLayer(map, 0, 1, rocks.granite.code, units(30000), { formedMin: 1 });
  openCut(map, 0, 0.2);
  setLayer(map, 0, 0, rocks.quartzite.code, units(4), { strength: 3000 }, "cut");
  projectGround(map, 0);
  return map;
}

it("lets a caller add a numeric question using mixtures and occupied shares without producer knowledge", () => {
  const map = mixedGround(),
    ground = groundOf(map);
  // This query is local to its consumer: no Ground handler or process registration is needed.
  const weatheredOpenness = averageGroundQuery({
    start: 0,
    rock: (_, { material }) => materialFact(material, "jointing") + material.damage,
  });
  const landOpenness = 0.75 * rocks.sandstone.jointing + 0.25 * rocks.shale.jointing + 0.4;
  expect(ground.fold(0, weatheredOpenness)).toBeCloseTo(
    0.8 * landOpenness + 0.2 * rocks.quartzite.jointing
  );
  expect(ground.fold(0, surfacePorosity)).toBeCloseTo(0.8 * 0.5 + 0.2 * rocks.quartzite.porosity);
  expect(ground.fold(0, surfaceResistance)).toBeCloseTo(0.8 * 900 + 0.2 * 3000);
  expect(ground.fold(0, weatheredOpenness, "land")).toBeCloseTo(landOpenness);
  expect(ground.fold(0, surfaceKind)).toBe(rocks.sandstone);
});

it("makes a newly exposed inherited bed answer the same unchanged consumer", () => {
  const map = mixedGround(),
    ground = groundOf(map);
  const before = ground.fold(0, surfacePorosity);
  removeRock(map, 0, units(4), "test");
  expect(ground.fold(0, surfacePorosity)).toBeLessThan(before);
  expect(ground.fold(0, surfacePorosity)).toBeCloseTo(rocks.granite.porosity);
});

it("passes complete material snapshots through custom queries without losing fabric or history", () => {
  const map = mixedGround(),
    ground = groundOf(map);
  const history: GroundQuery<readonly unknown[]> = {
    start: [],
    throughColumn: true,
    rock: (layers, { material }) => [...layers, material],
  };
  const retained = ground.fold(0, history, "land");
  expect(retained[0]).toMatchObject({
    secondaryKind: rocks.shale.code,
    secondaryShare: 0.25,
    damage: 0.4,
    grainX: 0.6,
    grainY: 0.8,
    formedMin: 2,
    formedMax: 5,
  });
  expect(retained[1]).toMatchObject({ kind: rocks.granite.code, formedMin: 1 });
  removeRock(map, 0, units(4), "test");
  expect(retained[0]).toMatchObject({ kind: rocks.sandstone.code, depth: units(4) });
});

it("does not visit stale beds belonging to an absent facet", () => {
  const map = mixedGround(),
    ground = groundOf(map);
  map.GroundCutShare.set(0, 0);
  expect(ground.fold(0, surfaceResistance, "cut")).toBe(surfaceResistance.start);
  expect(ground.fold(0, surfaceResistance)).toBeCloseTo(900);
  map.GroundCutShare.set(0, 1);
  expect(ground.fold(0, surfaceResistance, "land")).toBe(surfaceResistance.start);
  expect(ground.fold(0, surfaceResistance)).toBeCloseTo(3000);
});

it("distinguishes loose effective strength from its intact source and preserves altered basement strength", () => {
  const map = mixedGround(),
    ground = groundOf(map);
  setLayer(map, 0, 0, rocks.quartzite.code, units(2), { strength: 2500 }, "loose");
  setLayer(map, 0, 1, rocks.granite.code, units(30000), { strength: 1200 });
  const loose: GroundQuery<readonly number[]> = {
    start: [],
    loose: (_, layer) => [
      groundFact(layer, "resistance"),
      materialFact(layer.material, "resistance"),
    ],
  };
  expect(ground.fold(0, loose, "land")).toEqual([rocks.alluvium.resistance, 2500]);
  const crust: GroundQuery<number> = {
    start: 0,
    throughColumn: true,
    rock: (answer) => answer,
    crust: (_, layer) => groundFact(layer, "resistance"),
  };
  expect(ground.fold(0, crust, "land")).toBe(1200);
});
