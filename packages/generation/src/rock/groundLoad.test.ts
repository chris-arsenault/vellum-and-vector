import { expect, it } from "vitest";
import { createTestField as createField } from "./groundTestFixture";
import { createMesh } from "../world/mesh";
import { createWorldMesh } from "../world/worldMesh";
import { MaterialLoad, loadOf, seaLoadOf } from "./groundLoad";
import { materialLayer } from "./rockColumn";
import { rockCatalogue } from "./rockCatalogue";
import { carryOut } from "./groundLedger";

const field = () => createField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
const { basalt, shale } = rockCatalogue;

it("mixes cargo by volume while retaining both constituents and material history", () => {
  const map = field(),
    load = loadOf(map);
  load.add(0, materialLayer(basalt.code, 30, { strength: 400, damage: 0.2 }, 4));
  load.add(0, materialLayer(shale.code, 10, { strength: 100, damage: 0.6 }, 9));
  expect(load.get(0)).toMatchObject({
    kind: basalt.code,
    secondaryKind: shale.code,
    secondaryShare: 0.25,
    strength: 325,
    formedMin: 4,
    formedMax: 9,
    altered: 9,
    mixed: 1,
  });
  expect(load.get(0).damage).toBeCloseTo(0.3);
  expect(map.SedimentSupply.get(0)).toBeCloseTo((40 * 1024) / map.mesh.area(0));
});

it("returns an independent receipt and clips withdrawal to the actual held volume", () => {
  const map = field(),
    load = loadOf(map);
  load.add(0, materialLayer(basalt.code, 30, { grainX: 0.8 }, 4));
  const receipt = load.take(0, 10);
  load.add(0, materialLayer(shale.code, 20, {}, 9));
  expect(receipt).toMatchObject({ kind: basalt.code, depth: 10, grainX: 0.8, formedMax: 4 });
  expect(load.take(0, 100).depth).toBe(40);
  expect(load.amount(0)).toBe(0);
  expect(map.SedimentSupply.get(0)).toBe(0);
  load.add(0, materialLayer(shale.code, 5, {}, 12));
  expect(load.get(0)).toMatchObject({ kind: shale.code, formedMin: 12, formedMax: 12, mixed: 0 });
});

it("stores persistent cargo in the field without treating a scalar supply as material provenance", () => {
  const map = field();
  map.SedimentSupply.set(1, 500);
  const load = loadOf(map);
  expect(load.amount(1)).toBe(0);
  load.add(0, materialLayer(shale.code, 8, { altered: 7 }, 3));
  const anotherView = new MaterialLoad(map, "shared", "ground");
  expect(anotherView.get(0)).toMatchObject({ kind: shale.code, depth: 8, altered: 7 });
  anotherView.clear(0);
  expect(load.amount(0)).toBe(0);
  expect(map.SedimentSupply.get(0)).toBe(0);
});

it("keeps temporary routes and offshore cargo separate from worn supply", () => {
  const map = field(),
    supply = loadOf(map),
    route = new MaterialLoad(map, "test:route"),
    sea = seaLoadOf(map);
  supply.add(0, materialLayer(shale.code, 10, {}, 2));
  route.add(0, materialLayer(basalt.code, 15, {}, 5));
  sea.add(0, route.take(0, 15));
  route.release();
  expect(sea.get(0)).toMatchObject({ kind: basalt.code, depth: 15, formedMin: 5 });
  expect(supply.get(0)).toMatchObject({ kind: shale.code, depth: 10, formedMin: 2 });
  expect(map.SedimentSupply.get(0)).toBeCloseTo((10 * 1024) / map.mesh.area(0));
});

it("leaves empty cells outside the footprint with a finite supply projection", () => {
  const map = createField(createMesh(4, 1)),
    load = loadOf(map);
  expect(map.mesh.area(0)).toBe(0);
  load.take(0, 0);
  expect(map.SedimentSupply.get(0)).toBe(0);
});

it("keeps offshore deliveries at their receiving cells and off-map exports outside the field", () => {
  const map = field(),
    sea = seaLoadOf(map);
  carryOut(map, 20, "river-load", materialLayer(basalt.code, 20, {}, 2), 1);
  carryOut(map, 30, "moraines", materialLayer(shale.code, 30, {}, 7), 2);
  carryOut(map, 10, "river-load", materialLayer(basalt.code, 10, {}, 3));
  expect(sea.get(1)).toMatchObject({ kind: basalt.code, depth: 20, formedMin: 2 });
  expect(sea.get(2)).toMatchObject({ kind: shale.code, depth: 30, formedMin: 7 });
  expect(sea.amount(0)).toBe(0);
});
