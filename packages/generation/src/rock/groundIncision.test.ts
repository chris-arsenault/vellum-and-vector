import { expect, it } from "vitest";
import { Stage } from "../coupling/stage";
import { createTestField } from "./groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { elevationLimit, units } from "../world/math";
import { groundOf } from "./ground";
import { cutGround, deposit, erode, lithifyBuried, removeRock } from "./groundLedger";
import { loadOf } from "./groundLoad";
import { changeLayer, materialLayer, setLayer } from "./rockColumn";
import { rockCatalogue as rocks } from "./rockCatalogue";
import { facetSurface, openCut, projectGround } from "./groundShares";
import { compileMix } from "./modes";

const river = { id: "test", remembers: "CumulativeFluvialErosion" } as const;
function field(height = 100) {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  for (let cell = 0; cell < map.mesh.count; cell++) {
    map.BedrockElevation.set(cell, units(height));
    setLayer(map, cell, 0, rocks.quartzite.code, units(10), { formedMin: 4, formedMax: 4 });
    setLayer(map, cell, 1, rocks.shale.code, units(100), { formedMin: 2, formedMax: 2 });
    setLayer(map, cell, 2, rocks.granite.code, units(30000), { formedMin: 0, formedMax: 0 });
    projectGround(map, cell);
  }
  return map;
}
const surface = (map: ReturnType<typeof field>, facet: "land" | "cut") =>
  facetSurface(map, 0, facet) / 1024;

it("spends a small widening budget on intact material without deepening the existing floor", () => {
  const map = field();
  cutGround(map, 0, units(30), 0.1, "test");
  const actual = cutGround(map, 0, units(10), 0.3, "test");
  expect(map.GroundCutShare.get(0)).toBeCloseTo(0.2);
  expect(surface(map, "land")).toBeCloseTo(100);
  expect(surface(map, "cut")).toBeCloseTo(70);
  expect(actual.depth).toBe(0);
  expect(actual.amount / 1024).toBeCloseTo(3);
  expect(groundOf(map).section(0)[0]).toMatchObject({ kind: rocks.quartzite.code, formedMin: 4 });
  expect(groundOf(map).section(0, "cut")[0]).toMatchObject({
    kind: rocks.shale.code,
    formedMin: 2,
  });
});

it("deepens only after the requested width is paid for, then averages a narrower request", () => {
  const map = field();
  cutGround(map, 0, units(30), 0.1, "test");
  const actual = cutGround(map, 0, units(30), 0.3, "test");
  expect(map.GroundCutShare.get(0)).toBeCloseTo(0.3);
  expect(surface(map, "cut")).toBeCloseTo(60);
  expect(actual.depth / 1024).toBeCloseTo(10);
  cutGround(map, 0, units(10), 0.1, "test");
  expect(surface(map, "cut")).toBeCloseTo(60 - 10 / 3);
  expect(surface(map, "land")).toBeCloseTo(100);
});

it("widens through actual cover and rock while keeping the old valley fill and surviving cap", () => {
  const map = field();
  deposit(map, 0, units(10), "test", "load", materialLayer(rocks.limestone.code, 0, {}, 6));
  cutGround(map, 0, units(30), 0.1, "test");
  deposit(map, 0, units(0.5), "test", "load", materialLayer(rocks.basalt.code, 0, {}, 8), "cut");
  loadOf(map).clear(0);
  cutGround(map, 0, units(25 / 3), 0.3, "test");
  const land = groundOf(map).section(0),
    valley = groundOf(map).section(0, "cut");
  expect(surface(map, "land")).toBeCloseTo(110);
  expect(surface(map, "cut")).toBeCloseTo(85);
  expect(land[0]).toMatchObject({ kind: rocks.limestone.code, formedMin: 6, depth: units(10) });
  expect(land[1].kind).toBe(rocks.quartzite.code);
  expect(valley[0]).toMatchObject({ kind: rocks.basalt.code, formedMin: 8, medium: "loose" });
  expect(loadOf(map).get(0).formedMax).toBe(6);
});

it("handles the whole cell becoming cut without erasing its basement or inventing intact area", () => {
  const map = field();
  cutGround(map, 0, units(30), 0.1, "test");
  cutGround(map, 0, units(28), 1, "test");
  expect(map.GroundCutShare.get(0)).toBe(1);
  expect(groundOf(map).section(0)).toEqual([]);
  expect(surface(map, "cut")).toBeCloseTo(69);
  expect(groundOf(map).section(0, "cut").at(-1)).toMatchObject({
    kind: rocks.granite.code,
    basement: true,
  });
});

it("does not open a cut or record history before acceptance, including a rejected base-level request", () => {
  const map = field(1),
    stage = new Stage(map, { simultaneous: true });
  stage.cut(river, 0, units(20), 0.3);
  expect(map.GroundCutShare.get(0)).toBe(0);
  stage.settle();
  expect(map.GroundCutShare.get(0)).toBe(0);
  expect(map.CumulativeFluvialErosion.get(0)).toBe(0);
  expect(groundOf(map).section(0)[0].kind).toBe(rocks.quartzite.code);
});

it("settles widening before deposition and records width excavation separately from deepening", () => {
  const map = field();
  cutGround(map, 0, units(30), 0.1, "test");
  const stage = new Stage(map, { simultaneous: true });
  deposit(
    map,
    1,
    (units(2) * map.mesh.area(0)) / map.mesh.area(1),
    "test",
    "load",
    materialLayer(rocks.basalt.code, 0)
  );
  stage.cut(river, 0, units(10), 0.3);
  stage.moveLoose(1, 0, 2 * map.mesh.area(0), "test");
  stage.settle();
  expect(map.GroundCutShare.get(0)).toBeCloseTo(0.2, 3);
  expect(map.CumulativeFluvialErosion.get(0)).toBe(0);
  expect(map.SedimentThickness.get(0) / 1024).toBeCloseTo(2);
  expect(groundOf(map).section(0)[0].kind).toBe(rocks.basalt.code);
  expect(groundOf(map).section(0)[1].kind).toBe(rocks.quartzite.code);
});

it("shares starting cover between a floor cut and a competing loose route", () => {
  const map = field();
  openCut(map, 0, 0.2);
  deposit(
    map,
    0,
    units(2),
    "test",
    "load",
    materialLayer(rocks.basalt.code, 0, { altered: 7 }),
    "cut"
  );
  const stage = new Stage(map, { simultaneous: true });
  stage.cut(river, 0, units(1), 0.2);
  stage.moveLoose(0, 1, 2 * map.mesh.area(0), "transport");
  stage.settle();
  expect(map.CumulativeFluvialErosion.get(0) / 1024).toBeGreaterThan(0);
  expect(map.CumulativeFluvialErosion.get(0) / 1024).toBeLessThan(1);
  expect(groundOf(map).section(1)[0]).toMatchObject({ kind: rocks.basalt.code, altered: 7 });
  expect(surface(map, "land")).toBeCloseTo(100);
});

it("removes the requested surface depth from both bare and covered shares", () => {
  const map = field();
  openCut(map, 0, 0.2);
  deposit(map, 0, units(2), "test", "load", materialLayer(rocks.shale.code, 0), "cut");
  const stage = new Stage(map, { simultaneous: true });
  stage.wear(river, 0, units(1));
  stage.settle();
  expect(surface(map, "land")).toBeCloseTo(99);
  expect(surface(map, "cut")).toBeCloseTo(109);
  expect(map.SedimentThickness.get(0) / 1024).toBeCloseTo(1.8);
});

it("retains rejected routed material and records only the deposit that fits", () => {
  const map = field();
  map.BedrockElevation.set(1, units(elevationLimit - 0.25));
  projectGround(map, 1);
  const stage = new Stage(map, { simultaneous: true });
  stage.moveSurface(0, 1, map.mesh.area(0), "test");
  stage.settle();
  expect(map.SedimentThickness.get(1) / 1024).toBeCloseTo(0.25);
  expect(loadOf(map).get(0)).toMatchObject({ kind: rocks.quartzite.code, formedMin: 4 });
  expect(loadOf(map).amount(0) / map.mesh.area(0)).toBeCloseTo(0.75);
  expect(map.CumulativeDeposition.get(1) / 1024).toBeCloseTo(0.25);
  const before = map.CumulativeDeposition.get(2);
  expect(
    deposit(map, 2, units(1), "test", "load", materialLayer(rocks.basalt.code, 0), "cut")
  ).toBe(0);
  expect(map.CumulativeDeposition.get(2)).toBe(before);
});

it("keeps the dominant share projection current after changing an intact bed", () => {
  const map = field();
  openCut(map, 0, 0.8);
  changeLayer(map, 0, 0, rocks.basalt, "cut");
  changeLayer(map, 0, 0, rocks.quartzite, "land");
  expect(map.RockKindCodes.get(0)).toBe(rocks.basalt.code);
  expect(map.RockResistance.get(0)).toBeCloseTo(
    0.2 * rocks.quartzite.resistance + 0.8 * rocks.basalt.resistance
  );
});

it("reads soil as a skin and preserves it when removing rock beneath loose cover", () => {
  const map = field(),
    owner = groundOf(map),
    mix = compileMix({ abrasion: 1 }),
    bare = owner.actOn(0, mix, 0.1, units(10));
  map.SoilDepth.set(0, 1);
  expect(owner.actOn(0, mix, 0.1, units(10))).toBeGreaterThan(bare);
  deposit(map, 0, units(10), "test");
  removeRock(map, 0, units(2), "test");
  expect(map.SoilDepth.get(0)).toBe(1);
  expect(map.SedimentThickness.get(0) / 1024).toBe(10);
});

it("removes a shared soil skin once across both facets for direct and staged wear", () => {
  for (const staged of [false, true]) {
    const map = field();
    openCut(map, 0, 0.2);
    map.SoilDepth.set(0, 1);
    if (staged) {
      const stage = new Stage(map, { simultaneous: true });
      stage.wear(river, 0, units(2));
      stage.settle();
    } else erode(map, 0, units(2), "test");
    expect(map.SoilDepth.get(0)).toBe(0);
  }
});

it("uses retained loose constituents for surface response", () => {
  const map = field(),
    owner = groundOf(map),
    mix = compileMix({ solution: 1 });
  deposit(map, 0, units(25), "test", "load", materialLayer(rocks.saltbed.code, 0));
  deposit(map, 1, units(25), "test", "load", materialLayer(rocks.basalt.code, 0));
  expect(owner.gives(0, mix)).toBeGreaterThan(owner.gives(1, mix));
  expect(owner.actOn(0, mix, 1, units(5))).toBeGreaterThan(owner.actOn(1, mix, 1, units(5)));
});

it("cuts starting ground before a simultaneous new deposit", () => {
  const map = field(),
    stage = new Stage(map, { simultaneous: true });
  deposit(
    map,
    1,
    (units(10) * map.mesh.area(0)) / map.mesh.area(1),
    "test",
    "load",
    materialLayer(rocks.basalt.code, 0)
  );
  stage.moveLoose(1, 0, 10 * map.mesh.area(0), "test");
  stage.cut(river, 0, units(1), 1);
  stage.settle();
  expect(loadOf(map).get(0).kind).toBe(rocks.quartzite.code);
  expect(map.SedimentThickness.get(0) / 1024).toBe(10);
  expect(groundOf(map).section(0, "cut")[0].kind).toBe(rocks.basalt.code);
});

it("blocks a top-down solvent at an insoluble cap while exposing soluble beds on the side", () => {
  const map = field(),
    owner = groundOf(map),
    solvent = compileMix({ solution: 1 });
  changeLayer(map, 0, 1, rocks.limestone);
  expect(owner.actOn(0, solvent, 100, units(100))).toBe(0);
  const stage = new Stage(map, { simultaneous: true });
  stage.attack(river, 0, solvent, 100, units(100));
  stage.settle();
  expect(owner.section(0)[0]).toMatchObject({ kind: rocks.quartzite.code, depth: units(10) });
  expect(map.CumulativeFluvialErosion.get(0)).toBe(0);
});

it("settles each surface's material response and ignores an absent intact facet", () => {
  for (const share of [0.2, 1]) {
    const map = field();
    openCut(map, 0, share);
    changeLayer(map, 0, 0, rocks.limestone, "cut");
    const stage = new Stage(map, { simultaneous: true });
    stage.attack(river, 0, compileMix({ solution: 1 }), 1, units(5));
    stage.settle();
    expect(surface(map, "cut")).toBeLessThan(100);
    if (share < 1) expect(surface(map, "land")).toBe(100);
    expect(loadOf(map).get(0).kind).toBe(rocks.limestone.code);
  }
});

it("lithifies deep valley fill without hardening shallow cover on the intact share", () => {
  const map = field();
  openCut(map, 0, 0.2);
  deposit(map, 0, units(8), "test", "load", materialLayer(rocks.basalt.code, 0), "land");
  deposit(map, 0, units(400), "test", "load", materialLayer(rocks.limestone.code, 0, {}, 3), "cut");
  map.CompletedEpochCount = 7;
  lithifyBuried(map, 0, units(1000), 0.5, "burial");
  const owner = groundOf(map),
    intact = owner.section(0),
    valley = owner.section(0, "cut");
  expect(intact[0]).toMatchObject({ medium: "loose", depth: units(10), kind: rocks.basalt.code });
  expect(valley[0]).toMatchObject({ medium: "loose", depth: units(1500) });
  expect(valley[1]).toMatchObject({
    medium: "rock",
    depth: units(500),
    kind: rocks.limestone.code,
    formedMin: 3,
    altered: 7,
  });
});
