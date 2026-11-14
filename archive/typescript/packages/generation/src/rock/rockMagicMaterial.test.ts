import { expect, it } from "vitest";
import { magicMaterial } from "./rockMagic";
import { materialLayer } from "./rockColumn";
import { rockCatalogue as rocks } from "./rockCatalogue";
import { depositedMaterial } from "./groundConstruction";
import { burialResponse } from "./modes";

it.each([
  rocks.veinrock,
  rocks.auroraCrystal,
  rocks.rimerot,
  rocks.crushstone,
  rocks.rootstone,
  rocks.saltbed,
  rocks.keptStone,
  rocks.tornstone,
])("retains $name as material through reworking and burial without a magical field", (kind) => {
  const original = materialLayer(
    rocks.limestone.code,
    40,
    {
      grainX: 0.6,
      bedSlopeX: 0.2,
      deposited: 3,
    },
    1
  );
  const altered = magicMaterial(original, kind, 5);
  expect(altered).toMatchObject({
    kind: kind.code,
    strength: kind.resistance,
    formedMin: 1,
    formedMax: 1,
    deposited: 3,
    altered: 5,
    grainX: 0.6,
    bedSlopeX: 0.2,
    depth: 40,
  });
  const reworked = depositedMaterial(altered, 7);
  expect(reworked.altered).toBe(5);
  const buried = burialResponse(reworked, 9);
  expect(buried).toMatchObject({
    kind: kind.code,
    strength: kind.resistance,
    formedMin: 1,
    deposited: 7,
    altered: 9,
    grainX: 0.6,
  });
  expect(original.kind).toBe(rocks.limestone.code);
});

it("leaves an already altered body and its formation record intact on repeated exposure", () => {
  const old = materialLayer(rocks.veinrock.code, 20, { altered: 2, strength: 2900 }, 0);
  expect(magicMaterial(old, rocks.veinrock, 8)).toBe(old);
});
