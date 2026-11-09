import { expect, it } from "vitest";
import { blendLayers, materialLayer } from "./rockLayerFields";
import { rockCatalogue as rocks } from "./rockCatalogue";

it("uses contribution depth for material composition while retaining directional fabric and ages", () => {
  const a = materialLayer(rocks.shale.code, 120, {
      strength: 0.2,
      damage: 0.1,
      grainX: -1,
      grainY: 0.5,
      bedSlopeX: -2,
      bedSlopeY: 1,
      consolidation: 0.4,
      formedMin: 2,
      formedMax: 3,
      deposited: 5,
      altered: 6,
    }),
    b = materialLayer(rocks.basalt.code, 15, {
      strength: 0.8,
      damage: 0.5,
      grainX: 1,
      grainY: -0.5,
      bedSlopeX: 2,
      bedSlopeY: -1,
      consolidation: 1,
      formedMin: 1,
      formedMax: 4,
      deposited: 3,
      altered: 9,
    });
  const result = blendLayers(a, b, 1, 3);
  expect(result).toMatchObject({
    kind: rocks.basalt.code,
    secondaryKind: rocks.shale.code,
    secondaryShare: 0.25,
    depth: 4,
    grainX: 0.5,
    grainY: -0.25,
    bedSlopeX: 1,
    bedSlopeY: -0.5,
    formedMin: 1,
    formedMax: 4,
    deposited: 5,
    altered: 9,
    mixed: 1,
  });
  expect(result.strength).toBeCloseTo(0.65);
  expect(result.damage).toBeCloseTo(0.4);
  expect(result.consolidation).toBeCloseTo(0.85);
  expect(a.depth).toBe(120);
  expect(b.depth).toBe(15);
});
it("resolves equal constituent weights in donor order and combines repeated constituents", () => {
  const a = materialLayer(rocks.shale.code, 10, {
    secondaryKind: rocks.basalt.code,
    secondaryShare: 0.5,
  });
  const b = materialLayer(rocks.limestone.code, 20, {
    secondaryKind: rocks.sandstone.code,
    secondaryShare: 0.5,
  });
  expect(blendLayers(a, b, 1, 1)).toMatchObject({
    kind: rocks.shale.code,
    secondaryKind: rocks.basalt.code,
    secondaryShare: 0.5,
  });
  const c = materialLayer(rocks.basalt.code, 30, {
    secondaryKind: rocks.limestone.code,
    secondaryShare: 0.5,
  });
  expect(blendLayers(a, c, 1, 1)).toMatchObject({
    kind: rocks.basalt.code,
    secondaryKind: rocks.shale.code,
    secondaryShare: 1 / 3,
  });
});
it("keeps pairwise constituent reduction and same-kind history updates", () => {
  const a = materialLayer(
    rocks.shale.code,
    1,
    { secondaryKind: rocks.basalt.code, secondaryShare: 0.4 },
    1
  );
  const b = materialLayer(rocks.limestone.code, 1, {}, 2);
  const c = materialLayer(rocks.basalt.code, 1, {}, 3);
  const mixture = blendLayers(blendLayers(a, b), c);
  expect(mixture.kind).toBe(rocks.limestone.code);
  expect(mixture.secondaryKind).toBe(rocks.basalt.code);
  const altered = materialLayer(rocks.shale.code, 4, { damage: 1, grainX: 1 }, 8);
  expect(blendLayers(materialLayer(rocks.shale.code, 2, {}, 2), altered)).toMatchObject({
    formedMin: 2,
    formedMax: 8,
    altered: 8,
    deposited: 8,
    mixed: 1,
  });
});
