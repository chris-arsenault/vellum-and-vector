import { expect, it } from "vitest";
import { createTestField as createField } from "./groundTestFixture";
import { elevationLimit, units } from "../world/math";
import { createWorldMesh } from "../world/worldMesh";
import { buryCover, depositPackage, erode, lithify, weatherRockFacets } from "./groundLedger";
import { groundOf } from "./ground";
import { compileMix } from "./modes";
import { materialLayer, readLayer, setLayer } from "./rockColumn";
import { rockCatalogue as rocks } from "./rockCatalogue";
import { openCut, projectGround } from "./groundShares";

function belt(crust: number, rock: number) {
  const map = createField(createWorldMesh([0, 0, 1_000_000, 1_000_000], 16, 0));
  map.CrustContinentalFraction.set(0, 1000);
  map.CrustThickness.set(0, units(crust));
  map.CrustContinentalColumn.set(0, units(crust));
  map.CrustColumnsInitialized = true;
  map.SurfaceRockLoad.set(0, units(rock));
  map.BedrockElevation.set(0, units(rock));
  return map;
}
const crustOf = (map: ReturnType<typeof belt>) => map.CrustThickness.get(0) / 1024;

it("leaves the crust alone while wear is taking rock piled on it", () => {
  const map = belt(7000, 500);
  erode(map, 0, units(400), "test");
  expect(crustOf(map)).toBe(7000);
});

it("thins an old belt's root once wear cuts past the rock on it", () => {
  const map = belt(7000, 100);
  erode(map, 0, units(500), "test");
  expect(crustOf(map)).toBeLessThan(7000);
});

it("stops thinning at a normal continental column", () => {
  const map = belt(4000, 0);
  erode(map, 0, units(500), "test");
  expect(crustOf(map)).toBe(4000);
});

function coveredGround(height = 100) {
  const map = belt(4000, height);
  setLayer(map, 0, 0, rocks.gneiss.code, units(30_000));
  projectGround(map, 0);
  return map;
}
it("converts only each facet's responsive rock and stops when the next bed blocks the forcing", () => {
  const map = coveredGround(),
    ground = groundOf(map),
    solution = compileMix({ solution: 1 });
  setLayer(map, 0, 0, rocks.limestone.code, units(1), { formedMin: 2, formedMax: 2 });
  setLayer(map, 0, 1, rocks.basalt.code, units(8000));
  openCut(map, 0, 0.25);
  setLayer(map, 0, 0, rocks.basalt.code, units(5), {}, "cut");
  projectGround(map, 0);
  const depths: [number, number] = [
    ground.rockAction(0, solution, 100, units(10), "land"),
    ground.rockAction(0, solution, 100, units(10), "cut"),
  ];
  expect(depths).toEqual([units(1), 0]);
  weatherRockFacets(map, 0, depths, "test");
  expect(readLayer(map, 0, 0).kind).toBe(rocks.basalt.code);
  expect(readLayer(map, 0, 0, "loose")).toMatchObject({
    kind: rocks.limestone.code,
    depth: units(1),
    formedMin: 2,
  });
  expect(readLayer(map, 0, 0, "cut")).toMatchObject({ kind: rocks.basalt.code, depth: units(5) });
  expect(readLayer(map, 0, 0, "cutLoose").depth).toBe(0);
});
it("weathers beneath retained cover and keeps converted beds in their original vertical order", () => {
  const map = coveredGround(),
    ground = groundOf(map);
  setLayer(map, 0, 0, rocks.shale.code, units(2), { formedMin: 3, grainX: 0.4 });
  setLayer(map, 0, 1, rocks.limestone.code, units(3), { formedMin: 1, grainY: 0.7 });
  setLayer(map, 0, 2, rocks.gneiss.code, units(30_000));
  setLayer(map, 0, 0, rocks.tuff.code, units(2), { formedMin: 7 }, "loose");
  projectGround(map, 0);
  const depth = ground.rockAction(0, compileMix({ abrasion: 1 }), 1000, units(3), "land");
  weatherRockFacets(map, 0, [depth, 0], "test");
  expect(readLayer(map, 0, 0, "loose")).toMatchObject({
    kind: rocks.tuff.code,
    depth: units(2),
    formedMin: 7,
  });
  expect(readLayer(map, 0, 1, "loose")).toMatchObject({
    kind: rocks.shale.code,
    depth: units(2),
    formedMin: 3,
    grainX: 0.4,
  });
  expect(readLayer(map, 0, 2, "loose")).toMatchObject({
    kind: rocks.limestone.code,
    depth: units(1),
    formedMin: 1,
    grainY: 0.7,
  });
  expect(readLayer(map, 0, 0)).toMatchObject({ kind: rocks.limestone.code, depth: units(2) });
});
it("admits older package beds first and retains the partial boundary bed's material", () => {
  const map = coveredGround(elevationLimit - 5),
    packageBeds = [
      materialLayer(rocks.basalt.code, units(3), { formedMin: 7, formedMax: 7 }),
      materialLayer(rocks.shale.code, units(4), { formedMin: 4, formedMax: 4, grainX: 0.5 }),
      materialLayer(rocks.limestone.code, units(2), { formedMin: 1, formedMax: 1 }),
    ];
  expect(depositPackage(map, 0, packageBeds, "test")).toBe(units(5));
  expect(readLayer(map, 0, 0, "loose")).toMatchObject({
    kind: rocks.shale.code,
    depth: units(3),
    formedMin: 4,
    grainX: 0.5,
  });
  expect(readLayer(map, 0, 1, "loose")).toMatchObject({
    kind: rocks.limestone.code,
    depth: units(2),
    formedMin: 1,
  });
  expect(packageBeds[1].depth).toBe(units(4));
  expect(depositPackage(map, 0, packageBeds, "test")).toBe(0);
  expect(readLayer(map, 0, 0, "loose").kind).toBe(rocks.shale.code);
});
it("lands a mean-height package only in the chosen facet with local bed depths", () => {
  const map = coveredGround();
  openCut(map, 0, 0.25);
  map.GroundCutDepth.set(0, units(20));
  projectGround(map, 0);
  depositPackage(
    map,
    0,
    [
      materialLayer(rocks.basalt.code, units(1), { altered: 7 }),
      materialLayer(rocks.shale.code, units(3), { altered: 2 }),
    ],
    "test",
    "load",
    "cut"
  );
  expect(readLayer(map, 0, 0, "cutLoose")).toMatchObject({
    kind: rocks.basalt.code,
    depth: units(4),
    altered: 7,
  });
  expect(readLayer(map, 0, 1, "cutLoose")).toMatchObject({
    kind: rocks.shale.code,
    depth: units(12),
    altered: 2,
  });
  expect(readLayer(map, 0, 0, "loose").depth).toBe(0);
  expect(map.GroundCutShare.get(0)).toBe(0.25);
  expect(map.GroundCutDepth.get(0)).toBe(units(20));
});
it("buries each cover package in order and applies weak-bed state to each material", () => {
  const map = coveredGround();
  openCut(map, 0, 0.25);
  map.CompletedEpochCount = 8;
  setLayer(
    map,
    0,
    0,
    rocks.basalt.code,
    units(3),
    { formedMin: 4, formedMax: 4, grainX: 0.6 },
    "loose"
  );
  setLayer(map, 0, 1, rocks.limestone.code, units(6), { formedMin: 1, formedMax: 1 }, "loose");
  setLayer(map, 0, 0, rocks.shale.code, units(2), { formedMin: 2, formedMax: 2 }, "cutLoose");
  projectGround(map, 0);
  const height = map.Elevation.get(0);
  buryCover(map, 0);
  expect(readLayer(map, 0, 0)).toMatchObject({
    kind: rocks.basalt.code,
    depth: units(3),
    formedMin: 4,
    altered: 8,
    grainX: 0.6,
    damage: 0.5,
    strength: rocks.alluvium.resistance,
  });
  expect(readLayer(map, 0, 1)).toMatchObject({
    kind: rocks.limestone.code,
    depth: units(6),
    formedMin: 1,
    altered: 8,
    damage: 0.5,
  });
  expect(readLayer(map, 0, 2).kind).toBe(rocks.gneiss.code);
  expect(readLayer(map, 0, 0, "cut")).toMatchObject({
    kind: rocks.shale.code,
    depth: units(2),
    formedMin: 2,
    altered: 8,
  });
  expect(readLayer(map, 0, 0, "loose").depth).toBe(0);
  expect(readLayer(map, 0, 0, "cutLoose").depth).toBe(0);
  expect(map.Elevation.get(0)).toBe(height);
});
it("consolidates the oldest cover first while leaving younger material above it", () => {
  const map = coveredGround();
  map.CompletedEpochCount = 9;
  setLayer(map, 0, 0, rocks.basalt.code, units(3), { formedMin: 4, formedMax: 4 }, "loose");
  setLayer(map, 0, 1, rocks.limestone.code, units(6), { formedMin: 1, formedMax: 1 }, "loose");
  projectGround(map, 0);
  lithify(map, 0, units(7), "burial");
  expect(readLayer(map, 0, 0, "loose")).toMatchObject({
    kind: rocks.basalt.code,
    depth: units(2),
    formedMin: 4,
  });
  expect(readLayer(map, 0, 0)).toMatchObject({
    kind: rocks.basalt.code,
    depth: units(1),
    formedMin: 4,
    altered: 9,
  });
  expect(readLayer(map, 0, 1)).toMatchObject({
    kind: rocks.limestone.code,
    depth: units(6),
    formedMin: 1,
    altered: 9,
  });
});
