import { expect, it } from "vitest";
import { materialLayer, blendLayers, finiteSlice } from "./rockColumn";
import { extractConstituent } from "./groundExtraction";
import { alterMaterialInterval } from "./groundAlteration";
import { MaterialMixture } from "./materialMixture";
import { rockCatalogue as rocks } from "./rockCatalogue";
import { CargoMixture, aggregateCargo, blendCargo, rekeyCargo } from "./materialCargo";

it("selective withdrawal carries the charge on the withdrawn constituent", () => {
  const layer = materialLayer(rocks.saltbed.code, 8, {
      secondaryKind: rocks.granite.code,
      secondaryShare: 0.5,
      cargo: new Float64Array([1, rocks.saltbed.code, 3, 2, rocks.granite.code, 5]),
    }),
    result = extractConstituent(layer, rocks.saltbed.code, 4);
  expect(result.cargo).toEqual(new Float64Array([1, rocks.saltbed.code, 6]));
  expect(result.remaining.cargo).toEqual(new Float64Array([2, rocks.granite.code, 10]));
});

it("mixing dilutes separate origins while retaining cargo on a coarsened aggregate", () => {
  const a = materialLayer(rocks.saltbed.code, 1, {
      cargo: new Float64Array([1, rocks.saltbed.code, 12]),
    }),
    b = materialLayer(rocks.granite.code, 2, {
      cargo: new Float64Array([2, rocks.granite.code, 6]),
    }),
    c = materialLayer(rocks.limestone.code, 3),
    mixed = blendLayers(blendLayers(a, b), c),
    mixture = new MaterialMixture();
  mixture.add(a, 1);
  mixture.add(b, 2);
  mixture.add(c, 3);
  expect(mixed.cargo).toEqual(new Float64Array([1, 0, 2, 2, rocks.granite.code, 2]));
  expect(mixture.material(6)?.cargo).toEqual(mixed.cargo);
});

it("unrepresented basement and alteration below retained charge cannot recreate it", () => {
  const bed = materialLayer(rocks.granite.code, 11, {
    cargo: new Float64Array([4, rocks.granite.code, 8]),
  });
  expect(finiteSlice(bed, 20, true).cargo).toEqual(new Float64Array([4, rocks.granite.code, 4]));
  expect(finiteSlice(bed, 5, true, 15).cargo).toBeUndefined();
  const changed = alterMaterialInterval(
    [bed],
    15,
    20,
    (layer) => ({ ...layer, damage: 0.5 }),
    true
  );
  expect(changed[1].cargo).toBeUndefined();
  expect(changed[2].cargo).toBeUndefined();
});
it("keeps many reservoir-host pairs distinct and reusable across slab mixtures", () => {
  const input = new Float64Array(256 * 3),
    mixture = new CargoMixture();
  for (let key = 0; key < 256; key++) input.set([key + 1, key % 7, key + 0.5], key * 3);
  mixture.add(input, 1);
  mixture.add(new Float64Array([256, 3, 10]), 1);
  const first = mixture.finish(2)!;
  expect(Array.from(first.subarray(255 * 3))).toEqual([256, 3, 132.75]);
  mixture.clear();
  mixture.add(new Float64Array([256, 0, 2]), 1);
  expect(Array.from(mixture.finish(1)!)).toEqual([256, 0, 2]);
  expect(first[0]).toBe(1);
});
it("coalesces discarded host identities and rekeys without mutating prior parcels", () => {
  const source = new Float64Array([1, 12, 3, 1, 13, 4, 1, 14, 5]),
    coarse = aggregateCargo(source, 14, 15)!;
  expect(Array.from(coarse)).toEqual([1, 0, 7, 1, 14, 5]);
  const moved = rekeyCargo(coarse, 1, 2)!;
  const blended = blendCargo(moved, new Float64Array([2, 0, 9]), 1, 1)!;
  expect(Array.from(blended)).toEqual([2, 0, 8, 2, 14, 2.5]);
  expect(Array.from(coarse)).toEqual([1, 0, 7, 1, 14, 5]);
  expect(Array.from(source)).toEqual([1, 12, 3, 1, 13, 4, 1, 14, 5]);
});
