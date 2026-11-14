import { expect, it } from "vitest";
import { MaterialMixture } from "./materialMixture";
import { materialLayer } from "./rockLayerFields";
import { rockCatalogue } from "./rockCatalogue";

const { basalt, granite, limestone, shale } = rockCatalogue;

it("selects the largest constituents after every donor contributes, while retaining history and fabric", () => {
  const mixture = new MaterialMixture();
  for (const [index, kind] of [basalt, granite, limestone].entries())
    mixture.add(
      materialLayer(kind.code, 10, {
        secondaryKind: shale.code,
        secondaryShare: 0.4,
        strength: 1000 + index * 100,
        damage: index * 0.1,
        grainX: 100 - index * 50,
        grainY: index * 50,
        bedSlopeX: index * 0.1,
        bedSlopeY: -index * 0.1,
        consolidation: index * 0.2,
        deposited: index + 2,
        formedMin: index,
        formedMax: index + 3,
        altered: index + 5,
      }),
      1
    );
  const layer = mixture.material(27)!;
  expect(layer).toMatchObject({
    kind: shale.code,
    secondaryKind: basalt.code,
    depth: 27,
    strength: 1100,
    grainX: 50,
    grainY: 50,
    deposited: 4,
    formedMin: 0,
    formedMax: 5,
    altered: 7,
    mixed: 1,
  });
  expect(layer.secondaryShare).toBeCloseTo(1 / 3);
  expect(layer.damage).toBeCloseTo(0.1);
  expect(layer.bedSlopeX).toBeCloseTo(0.1);
  expect(layer.bedSlopeY).toBeCloseTo(-0.1);
  expect(layer.consolidation).toBeCloseTo(0.2);
});

it("reuses scratch without contaminating later material or changing an earlier detached layer", () => {
  const mixture = new MaterialMixture(),
    first = materialLayer(basalt.code, 4, { formedMin: 2, altered: 8 });
  mixture.add(first, 0.25);
  const retained = mixture.material(1)!;
  mixture.reset();
  expect(mixture.material(0)).toBeNull();
  mixture.add(first, 0);
  mixture.add(materialLayer(shale.code, 7, { formedMin: 5, altered: 5 }), 0.75);
  expect(mixture.material(3)).toMatchObject({
    kind: shale.code,
    secondaryKind: shale.code,
    secondaryShare: 0,
    depth: 3,
    formedMin: 5,
    altered: 5,
    mixed: 0,
  });
  expect(retained).toMatchObject({ kind: basalt.code, depth: 1, formedMin: 2, altered: 8 });
});

it("weights both donor constituents and scalar properties by the represented area", () => {
  const mixture = new MaterialMixture();
  mixture.add(materialLayer(granite.code, 10, { strength: 1000, grainX: 1000 }), 0.75);
  mixture.add(materialLayer(basalt.code, 20, { strength: 2000, grainX: -1000 }), 0.25);
  expect(mixture.material(12)).toMatchObject({
    kind: granite.code,
    secondaryKind: basalt.code,
    secondaryShare: 0.25,
    strength: 1250,
    grainX: 500,
    depth: 12,
  });
});
