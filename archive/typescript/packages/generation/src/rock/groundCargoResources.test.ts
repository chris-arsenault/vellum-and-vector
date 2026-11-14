import { expect, it } from "vitest";
import { captureMaterialCargo, importMaterialCargo } from "./groundCargoResources";
import { createTestField } from "./groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { GroundInventory } from "./groundInventory";
import { materialLayer, readLayer, setLayer } from "./rockColumn";
import { rockCatalogue as rocks } from "./rockCatalogue";
import { loadOf, seaLoadOf } from "./groundLoad";
import { units } from "../world/math";
import { releasedMaterial } from "./groundCargoIdentity";

const supplied = () => createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
function beds(map: ReturnType<typeof supplied>, cell: number) {
  setLayer(map, cell, 0, rocks.saltbed.code, units(2));
  setLayer(map, cell, 1, rocks.saltbed.code, units(3));
  setLayer(map, cell, 2, rocks.granite.code, 1);
}
it("imports named cargo with its selected buried donor, keeping fresh same-mineral cover inert", () => {
  const source = supplied(),
    salt = new GroundInventory(source, "salt:sea/bed");
  beds(source, 0);
  beds(source, 1);
  setLayer(source, 0, 1, rocks.saltbed.code, units(3), {
    formedMin: 2,
    cargo: new Float64Array([salt.key, rocks.saltbed.code, 10]),
  });
  const captured = captureMaterialCargo(source),
    target = supplied();
  new GroundInventory(target, "society:forge");
  const inherited = new GroundInventory(target, "salt:sea/bed");
  beds(target, 0);
  beds(target, 1);
  importMaterialCargo(target, captured, (cell) => (cell === 1 ? 0 : cell));
  expect(inherited.key).not.toBe(salt.key);
  expect(inherited.reached(0, units(2))).toBe(0);
  expect(inherited.get(0)).toBeCloseTo(target.mesh.area(0) * 30);
  expect(readLayer(target, 0, 0).cargo).toBeUndefined();
  expect(readLayer(target, 0, 1).cargo?.[0]).toBe(inherited.key);
  expect(inherited.get(1)).toBeCloseTo(target.mesh.area(1) * 30);
  salt.set(0, 0);
  expect(inherited.get(0)).toBeCloseTo(target.mesh.area(0) * 30);
  expect(captured.records.get(3)).toBe(10);
});
it("captures persistent ground and offshore carrier cargo with society key names", () => {
  const source = supplied(),
    key = new GroundInventory(source, "society:city/stock", "salt:sea/bed").key,
    parcel = materialLayer(rocks.saltbed.code, 6, {
      cargo: new Float64Array([key, rocks.saltbed.code, 4]),
      formedMin: 2,
    });
  loadOf(source).add(0, parcel);
  seaLoadOf(source).add(0, { ...parcel, depth: 9 });
  const captured = captureMaterialCargo(source),
    target = supplied();
  loadOf(target).add(0, { ...parcel, cargo: undefined });
  seaLoadOf(target).add(0, { ...parcel, depth: 9, cargo: undefined });
  importMaterialCargo(target, captured);
  const restored = new GroundInventory(target, "society:city/stock");
  expect(loadOf(target).get(0)).toMatchObject({ depth: 6, formedMin: 2 });
  expect(Array.from(loadOf(target).get(0).cargo!)).toEqual([restored.key, rocks.saltbed.code, 4]);
  expect(seaLoadOf(target).get(0).cargo?.[2]).toBe(4);
  loadOf(source).clear(0);
  expect(loadOf(target).get(0).cargo?.[2]).toBe(4);
  const natural = new GroundInventory(target, "salt:sea/bed"),
    released = releasedMaterial(target, loadOf(target).get(0));
  expect(Array.from(released.cargo!)).toEqual([natural.key, rocks.saltbed.code, 4]);
  expect(captured.releasedTo[captured.keys.indexOf("society:city/stock")]).toBe("salt:sea/bed");
  expect(loadOf(target).get(0).cargo?.[0]).toBe(restored.key);
});
it("rejects missing custody metadata rather than guessing an original reservoir", () => {
  const map = supplied(),
    captured = captureMaterialCargo(map);
  expect(() =>
    importMaterialCargo(map, { ...captured, releasedTo: undefined } as unknown as typeof captured)
  ).toThrow("release target");
});
it.each(["bed", "ground-load", "sea-load"])(
  "rejects unrepresentable %s cargo before publishing a captured resource",
  (slot) => {
    const map = supplied(),
      key = new GroundInventory(map, "greenwood:stand/stratum").key,
      cargo = new Float64Array([key, rocks.rootstone.code, Infinity]);
    if (slot === "bed") setLayer(map, 0, 0, rocks.rootstone.code, units(2), { cargo });
    else
      (slot === "ground-load" ? loadOf(map) : seaLoadOf(map)).add(
        0,
        materialLayer(rocks.rootstone.code, 2, { cargo })
      );
    expect(() => captureMaterialCargo(map)).toThrow("positive density");
  }
);
