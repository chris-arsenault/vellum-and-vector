import { expect, it, vi } from "vitest";
import { createTestField } from "./groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { GroundInventory } from "./groundInventory";
import { materialLayer, readLayer, setLayer } from "./rockColumn";
import { constructMaterial } from "./groundConstruction";
import { openCut } from "./groundShares";
import { rockCatalogue as rocks } from "./rockCatalogue";
import { units } from "../world/math";

function supplied() {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0)),
    stock = new GroundInventory(map, "salt:test/bed");
  setLayer(map, 0, 0, rocks.granite.code, 1);
  stock.construct(0, map.mesh.area(0) * 30, units(3), rocks.saltbed.code, "test");
  return { map, stock, area: map.mesh.area(0) };
}
it("burial changes access while fresh same-mineral cover acquires no charge", () => {
  const { map, stock, area } = supplied();
  expect(stock.get(0)).toBeCloseTo(area * 30);
  constructMaterial(map, 0, materialLayer(rocks.saltbed.code, units(2)), "test", "space");
  expect(stock.get(0)).toBeCloseTo(area * 30);
  expect(stock.reached(0, units(2))).toBe(0);
  expect(stock.extract(0, area * 10, { reach: units(2) })).toBe(0);
  expect(readLayer(map, 0, 0).cargo).toBeUndefined();
  expect(stock.release(0, units(3), () => 0.5)).toBeCloseTo(area * 5);
  expect(stock.get(0)).toBeCloseTo(area * 25);
});
it("selective extraction accounts for actual facet area and aggregate host charge", () => {
  const { map, stock, area } = supplied();
  openCut(map, 0, 0.2);
  const parcels: ReturnType<typeof readLayer>[] = [];
  expect(stock.extract(0, area * 5, { reach: units(3) }, (p) => parcels.push(p))).toBeCloseTo(
    area * 5
  );
  expect(parcels[0].cargo?.[0]).toBe(stock.key);
  setLayer(
    map,
    1,
    0,
    rocks.shale.code,
    units(2),
    {
      cargo: new Float64Array([stock.key, 0, 10]),
    },
    "loose"
  );
  expect(stock.extract(1, map.mesh.area(1) * 5, { reach: units(2) })).toBeCloseTo(
    map.mesh.area(1) * 5
  );
});
it("charging finite basement cannot charge its unbounded continuation", () => {
  const { map, stock, area } = supplied();
  setLayer(map, 1, 0, rocks.saltbed.code, units(2) + 1);
  stock.charge(1, area * 8, units(20), [rocks.saltbed.code]);
  expect(stock.get(1)).toBeCloseTo(area * 8);
  expect(readLayer(map, 1, 1).cargo).toBeUndefined();
  expect(readLayer(map, 1, 1).depth).toBe(1);
});
it("caches queried cells without allocating a whole-map band for every local inventory", () => {
  const { map, stock, area } = supplied(),
    allocate = vi.spyOn(map.coverage, "scratch"),
    read = vi.spyOn(stock, "reached");
  for (let key = 0; key < 64; key++)
    expect(new GroundInventory(map, `society/${key}/salt:bed`).get(0)).toBe(0);
  expect(allocate.mock.calls.some(([, name]) => name.includes("inventory"))).toBe(false);
  expect(stock.get(0)).toBeCloseTo(area * 30);
  expect(stock.get(0)).toBeCloseTo(area * 30);
  expect(read).toHaveBeenCalledTimes(1);
  stock.set(0, area * 15);
  expect(stock.get(0)).toBeCloseTo(area * 15);
  expect(read).toHaveBeenCalledTimes(2);
});

it("reads reached inventory through each facet's actual cover and finite basement interval", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0)),
    stock = new GroundInventory(map, "salt:bed"),
    other = new GroundInventory(map, "unrelated:held"),
    area = map.mesh.area(0);
  setLayer(map, 0, 0, rocks.saltbed.code, units(2) + 1, {
    cargo: new Float64Array([stock.key, rocks.saltbed.code, 11]),
  });
  openCut(map, 0, 0.25);
  setLayer(
    map,
    0,
    0,
    rocks.saltbed.code,
    units(3) + 1,
    {
      cargo: new Float64Array([stock.key, 0, 7]),
    },
    "cut"
  );
  setLayer(
    map,
    0,
    0,
    rocks.shale.code,
    units(1),
    {
      cargo: new Float64Array([
        stock.key,
        0,
        2,
        stock.key,
        rocks.saltbed.code,
        3,
        other.key,
        rocks.shale.code,
        100,
      ]),
    },
    "loose"
  );
  setLayer(map, 0, 0, rocks.shale.code, units(2), {}, "cutLoose");
  expect(stock.reached(0, units(1.5))).toBeCloseTo(area * 0.75 * (5 + 0.5 * 11));
  expect(stock.reached(0, units(3))).toBeCloseTo(area * (0.75 * 27 + 0.25 * 7));
  expect(stock.reached(0, Infinity)).toBeCloseTo(area * (0.75 * 27 + 0.25 * 21));
  setLayer(map, 1, 0, rocks.saltbed.code, 1, {
    cargo: new Float64Array([stock.key, 0, 99]),
  });
  expect(stock.reached(1, Infinity)).toBe(0);
});
