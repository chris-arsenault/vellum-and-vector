import { expect, it } from "vitest";
import { MapScale } from "@atlas/domain";
import { createTestField } from "./groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { constructMaterial } from "./groundConstruction";
import { materialLayer, readLayer, setLayer } from "./rockColumn";
import { rockCatalogue as rocks } from "./rockCatalogue";
import { withdrawColumn, placeMaterial } from "./groundMaterial";
import { MaterialLoad } from "./groundLoad";
import {
  holdRock,
  releaseHeldRock,
  transplantHeldColumn,
  placeCarriedGround,
} from "./groundTransport";
import { units } from "../world/math";
import { GroundInventory } from "./groundInventory";

function supplied() {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  setLayer(map, 0, 0, rocks.granite.code, units(100));
  constructMaterial(
    map,
    0,
    materialLayer(rocks.saltbed.code, units(3), {
      cargo: new Float64Array([1, rocks.saltbed.code, 7]),
    }),
    "test",
    "space"
  );
  constructMaterial(map, 0, materialLayer(rocks.saltbed.code, units(2)), "test", "space");
  return map;
}

it("a fresh uncharged bed of the same mineral neither exposes nor acquires buried charge", () => {
  const map = supplied(),
    parcels: ReturnType<typeof materialLayer>[] = [];
  expect(readLayer(map, 0, 0).cargo).toBeUndefined();
  expect(readLayer(map, 0, 1).cargo).toEqual(new Float64Array([1, rocks.saltbed.code, 7]));
  withdrawColumn(map, 0, "land", units(2), (parcel) => parcels.push(parcel));
  expect(parcels.every((parcel) => !parcel.cargo)).toBe(true);
  expect(readLayer(map, 0, 0).cargo).toEqual(new Float64Array([1, rocks.saltbed.code, 7]));
});

it("ordinary material receipts carry cargo through a load and new deposition", () => {
  const map = supplied(),
    load = new MaterialLoad(map, "test:carried-material");
  withdrawColumn(map, 0, "land", units(2));
  withdrawColumn(map, 0, "land", units(1), (parcel) =>
    load.add(1, {
      ...parcel,
      depth: MapScale.metres(parcel.depth, "native") * map.mesh.area(0),
    })
  );
  const delivered = load.take(1, load.amount(1));
  placeMaterial(map, 1, "loose", {
    ...delivered,
    depth: units(delivered.depth / map.mesh.area(1)),
  });
  expect(readLayer(map, 1, 0, "loose").cargo).toEqual(new Float64Array([1, rocks.saltbed.code, 7]));
  expect(load.get(1).cargo).toBeUndefined();
  load.release();
});

it("captured donor cargo stays immutable through subsequent writes and transfers", () => {
  const map = supplied(),
    held = holdRock(map),
    before = held.read(0, 1).cargo;
  setLayer(map, 0, 1, rocks.saltbed.code, units(3));
  transplantHeldColumn(map, held, 1, 0);
  expect(held.read(0, 1).cargo).toEqual(before);
  expect(readLayer(map, 1, 1).cargo).toEqual(before);
  setLayer(map, 1, 1, rocks.saltbed.code, units(3));
  expect(held.read(0, 1).cargo).toEqual(before);
  releaseHeldRock(map, held);
});
it("geological carry releases custody while snapshot restoration preserves it", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0)),
    original = new GroundInventory(map, "salt:bed"),
    owned = new GroundInventory(map, "custodian", "salt:bed");
  for (const cell of [0, 1, 2]) setLayer(map, cell, 0, rocks.granite.code, units(100));
  setLayer(
    map,
    0,
    0,
    rocks.saltbed.code,
    units(1),
    { formedMin: 2, cargo: new Float64Array([owned.key, rocks.saltbed.code, 4]) },
    "loose"
  );
  const held = holdRock(map);
  transplantHeldColumn(map, held, 1, 0);
  expect(owned.get(1)).toBeCloseTo(map.mesh.area(1) * 4);
  expect(original.get(1)).toBe(0);
  placeCarriedGround(map, held, 2, 0, [1, 0, 0, 1]);
  expect(owned.get(2)).toBe(0);
  expect(original.get(2)).toBeCloseTo(map.mesh.area(2) * 4);
  expect(held.read(0, 0, "loose").cargo?.[0]).toBe(owned.key);
  expect(readLayer(map, 2, 0, "loose").formedMin).toBe(2);
  releaseHeldRock(map, held);
});
