import { expect, it } from "vitest";
import { createTestField as createField } from "./groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { units } from "../world/math";
import { Stage } from "../coupling/stage";
import { groundOf } from "./ground";
import { cutGround, deposit, displaceGround, lithify, standGround } from "./groundLedger";
import { setLayer, materialLayer } from "./rockColumn";
import { rockCatalogue as rocks } from "./rockCatalogue";
import { projectGround } from "./groundShares";
import { compileMix } from "./modes";
import { hardenRock } from "./rockField";

function ground() {
  const map = createField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  for (let cell = 0; cell < map.mesh.count; cell++) {
    standGround(map, cell, units(500), "initial input");
    setLayer(map, cell, 0, rocks.quartzite.code, units(10), {
      strength: 3800,
      formedMin: 1,
      formedMax: 1,
    });
    setLayer(map, cell, 1, rocks.shale.code, units(100), { formedMin: 0, formedMax: 0 });
    setLayer(map, cell, 2, rocks.granite.code, units(1000));
    projectGround(map, cell);
  }
  return map;
}
it("keeps an intact cap beside a deep cut and buries only its floor", () => {
  const map = ground(),
    owner = groundOf(map),
    view = owner.view("Elevation");
  cutGround(map, 0, units(30), 0.1, "test");
  expect(owner.section(0, "land")[0].kind).toBe(rocks.quartzite.code);
  expect(owner.section(0, "cut")[0].kind).toBe(rocks.shale.code);
  expect(view.get(0) / 1024).toBeCloseTo(497);
  const fill = materialLayer(rocks.basalt.code, units(1), {
    strength: 2800,
    formedMin: 2,
    formedMax: 2,
  });
  deposit(map, 0, units(1), "test", "load", fill, "cut");
  const valley = owner.section(0, "cut");
  expect(valley[0].medium).toBe("loose");
  expect(valley[0].depth / 1024).toBeCloseTo(10);
  expect(valley[0].kind).toBe(rocks.basalt.code);
  expect(owner.section(0, "land")[0].strength).toBe(3800);
  cutGround(map, 0, units(5), 0.1, "test");
  expect(owner.section(0, "cut")[0].depth / 1024).toBeCloseTo(5);
});
it("converts retained buried material and translates it without changing its age", () => {
  const map = ground(),
    owner = groundOf(map),
    fill = materialLayer(rocks.limestone.code, units(20), { formedMin: 3, formedMax: 3 });
  deposit(map, 0, units(20), "test", "load", fill);
  map.CompletedEpochCount = 8;
  lithify(map, 0, units(15), "test");
  const before = owner.section(0);
  expect(before[1].kind).toBe(rocks.limestone.code);
  expect(before[1].formedMin).toBe(3);
  expect(before[1].altered).toBe(8);
  displaceGround(map, 0, units(300), "test");
  const after = owner.section(0);
  expect(after[1].top - before[1].top).toBe(units(300));
  expect(after[1].formedMin).toBe(before[1].formedMin);
  expect(after[1].depth).toBe(before[1].depth);
});
it("exposes a weak face below a cap without granting top access through the cap", () => {
  const map = ground(),
    owner = groundOf(map),
    shear = compileMix({ shear: 1 });
  displaceGround(map, 1, -units(60), "test");
  const face = owner.face(0, 1);
  expect(face.map((bed) => bed.kind)).toContain(rocks.shale.code);
  expect(owner.section(0)[0].kind).toBe(rocks.quartzite.code);
  expect(owner.faceGives(0, 1, shear)).toBeGreaterThan(owner.gives(0, shear));
});
it("retains independent source material through competing routed withdrawals", () => {
  const map = ground();
  deposit(
    map,
    0,
    units(2),
    "test",
    "load",
    materialLayer(rocks.basalt.code, units(2), { altered: 4 })
  );
  deposit(
    map,
    1,
    units(2),
    "test",
    "load",
    materialLayer(rocks.limestone.code, units(2), { altered: 7 })
  );
  const stage = new Stage(map, { simultaneous: true }),
    volume = 4 * map.mesh.area(0);
  stage.moveLoose(0, 2, volume, "test");
  stage.moveLoose(1, 3, volume, "test");
  stage.settle();
  expect(groundOf(map).section(2)[0].kind).toBe(rocks.basalt.code);
  expect(groundOf(map).section(2)[0].altered).toBe(4);
  expect(groundOf(map).section(3)[0].kind).toBe(rocks.limestone.code);
  expect(groundOf(map).section(3)[0].altered).toBe(7);
});
it("blocks top-down solution at an insoluble cap and reads an occupied cut independently", () => {
  const map = ground(),
    owner = groundOf(map),
    solution = compileMix({ solution: 1 });
  setLayer(map, 0, 1, rocks.limestone.code, units(100));
  expect(owner.actOn(0, solution, 100, Infinity)).toBe(0);
  cutGround(map, 0, units(20), 0.2, "test");
  const depths = owner.surfaceAction(0, solution, 1, Infinity);
  expect(depths[0]).toBe(0);
  expect(depths[1]).toBeGreaterThan(0);
  const platform = owner.surfaceAction(0, compileMix({ abrasion: 1 }), 100, Infinity, units(490));
  expect(platform[0]).toBe(units(10));
  expect(platform[1]).toBe(0);
  cutGround(map, 0, units(20), 1, "test");
  expect(owner.surfaceAction(0, solution, 1, Infinity)[0]).toBe(0);
  expect(owner.actOn(0, solution, 1, Infinity)).toBeGreaterThan(0);
});
it("hardens a weak exposed facet without weakening the resistant cap beside it", () => {
  const map = ground();
  cutGround(map, 0, units(30), 0.5, "test");
  hardenRock(map, 0, "basalt", 2500);
  expect(groundOf(map).section(0)[0]).toMatchObject({ kind: rocks.quartzite.code, strength: 3800 });
  expect(groundOf(map).section(0, "cut")[0]).toMatchObject({
    kind: rocks.basalt.code,
    strength: 2500,
  });
});
