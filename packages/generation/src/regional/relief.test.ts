import { expect, it } from "vitest";
import { createTestField } from "../rock/groundTestFixture";
import { loadOf } from "../rock/groundLoad";
import { projectGround } from "../rock/groundShares";
import { readLayer, setLayer } from "../rock/rockColumn";
import { rockCatalogue as rocks } from "../rock/rockCatalogue";
import { createWorldMesh } from "../world/worldMesh";
import { realizeSurface } from "./relief";

function suppliedGround() {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  for (let cell = 0; cell < map.mesh.count; cell++) {
    map.BedrockElevation.set(cell, 1000);
    setLayer(map, cell, 0, rocks.sandstone.code, 20, { formedMin: 3, formedMax: 3 });
    setLayer(map, cell, 1, rocks.granite.code, 100, { formedMin: 1, formedMax: 1 });
    projectGround(map, cell);
  }
  return map;
}

it("a lowered initial surface excavates actual beds into reusable material load", () => {
  const map = suppliedGround(),
    target = Float64Array.from({ length: map.mesh.count }, () => 980);
  realizeSurface(map, target);
  expect(map.Elevation.get(0)).toBeCloseTo(980);
  expect(readLayer(map, 0, 0)).toMatchObject({ kind: rocks.granite.code, formedMin: 1 });
  expect(loadOf(map).get(0)).toMatchObject({ kind: rocks.sandstone.code, formedMin: 3 });
  expect(loadOf(map).amount(0)).toBeGreaterThan(0);
});

it("positive detail displaces inherited beds and bends their retained contact", () => {
  const map = suppliedGround(),
    cell = map.mesh.cellAt(0, 0),
    target = Float64Array.from(
      { length: map.mesh.count },
      (_, i) => 1100 + map.mesh.x(i) - map.mesh.bounds[0]
    );
  realizeSurface(map, target);
  expect(map.Elevation.get(cell)).toBeCloseTo(target[cell]);
  expect(readLayer(map, cell, 0)).toMatchObject({
    kind: rocks.sandstone.code,
    depth: 20,
    formedMin: 3,
  });
  expect(Math.abs(readLayer(map, cell, 0).bedSlopeX)).toBeGreaterThan(0);
  expect(loadOf(map).amount(cell)).toBe(0);
});
