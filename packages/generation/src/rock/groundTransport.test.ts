import { expect, it } from "vitest";
import { createTestField as createField } from "./groundTestFixture";
import { createMesh } from "../world/mesh";
import { units } from "../world/math";
import { rockCatalogue } from "./rockCatalogue";
import { readLayer, setLayer, watchColumn, type MaterialLayer } from "./rockColumn";
import { openCut, projectGround } from "./groundShares";
import { withdrawColumn } from "./groundMaterial";
import {
  accreteHeldGround,
  accreteHeldCover,
  deformFabric,
  deformGround,
  heldLayers,
  landCollisionPackage,
  holdRock,
  placeCarriedGround,
  releaseHeldRock,
} from "./groundTransport";

const { basalt, shale, granite } = rockCatalogue;
function ground() {
  const map = createField(createMesh(4, 0));
  setLayer(map, 0, 0, basalt.code, units(10), {
    strength: 2900,
    formedMin: 1,
    formedMax: 1,
    altered: 3,
    grainX: 1,
  });
  setLayer(map, 0, 1, shale.code, units(100), { formedMin: 0, formedMax: 0 });
  setLayer(map, 0, 2, granite.code, units(30_000));
  setLayer(map, 1, 0, granite.code, units(30_000));
  map.BedrockElevation.set(0, units(300));
  map.SurfaceRockLoad.set(0, units(40));
  map.CrustSuturePairIds.set(0, 7);
  map.CrustSutureStrength.set(0, 800);
  projectGround(map, 0);
  return map;
}
it("moves a complete material package and both surface shares to its new placement", () => {
  const map = ground();
  openCut(map, 0, 0.25);
  withdrawColumn(map, 0, "cut", units(20));
  map.GroundCutDepth.set(0, units(20));
  setLayer(map, 0, 0, shale.code, units(8), { altered: 2 }, "cutLoose");
  const held = holdRock(map);
  placeCarriedGround(map, held, 1, 0, [1, 0, 0, 1]);
  expect(readLayer(map, 1, 0)).toMatchObject({
    kind: basalt.code,
    strength: 2900,
    formedMin: 1,
    altered: 3,
  });
  expect(readLayer(map, 1, 0, "cut").kind).toBe(shale.code);
  expect(readLayer(map, 1, 0, "cutLoose")).toMatchObject({
    kind: shale.code,
    depth: units(8),
    altered: 2,
  });
  expect(map.GroundCutShare.get(1)).toBe(0.25);
  expect(map.GroundCutDepth.get(1)).toBe(units(20));
  expect(map.CrustSuturePairIds.get(1)).toBe(7);
  expect(map.CrustSutureStrength.get(1)).toBe(800);
  expect(map.Elevation.get(1)).toBe(units(302));
  releaseHeldRock(map, held);
});
it("accretes the actual bounded donor slice and exposes its inherited contrast after removal", () => {
  const map = ground(),
    held = holdRock(map);
  const before = heldLayers(held, 0);
  accreteHeldGround(map, held, 1, 0, units(40));
  expect(readLayer(map, 1, 0)).toMatchObject({ kind: basalt.code, depth: units(10), altered: 3 });
  expect(readLayer(map, 1, 1)).toMatchObject({ kind: shale.code, depth: units(30) });
  expect(readLayer(map, 1, 2).kind).toBe(granite.code);
  withdrawColumn(map, 1, "land", units(10));
  expect(readLayer(map, 1, 0).kind).toBe(shale.code);
  expect(before[0].depth).toBe(units(10));
  releaseHeldRock(map, held);
});
it("spreads a complete collision package across area without selecting only its cap", () => {
  const map = ground(),
    held = holdRock(map);
  landCollisionPackage(map, held, 1, 0, 0.1, [1, 0, 0, 1]);
  expect(readLayer(map, 1, 0)).toMatchObject({ kind: basalt.code, depth: units(1), altered: 3 });
  expect(readLayer(map, 1, 1)).toMatchObject({ kind: shale.code, depth: units(3), formedMin: 0 });
  expect(readLayer(map, 1, 2).kind).toBe(granite.code);
  withdrawColumn(map, 1, "land", units(1));
  expect(readLayer(map, 1, 0)).toMatchObject({ kind: shale.code, depth: units(3) });
  releaseHeldRock(map, held);
});
it("keeps each captured donor's material when successive collision footprints change source", () => {
  const map = ground();
  setLayer(map, 2, 0, granite.code, units(30_000), { altered: 8, grainY: 500 });
  map.SurfaceRockLoad.set(2, units(10));
  const held = holdRock(map);
  landCollisionPackage(map, held, 1, 0, 0.1, [1, 0, 0, 1]);
  landCollisionPackage(map, held, 1, 2, 0.1, [1, 0, 0, 1]);
  expect(readLayer(map, 1, 0)).toMatchObject({
    kind: granite.code,
    depth: units(1),
    altered: 8,
    grainY: 500,
  });
  // Later source writes cannot alter the material already captured for this move.
  setLayer(map, 0, 0, granite.code, units(20), { altered: 9 });
  landCollisionPackage(map, held, 1, 0, 0.1, [1, 0, 0, 1]);
  expect(readLayer(map, 1, 0)).toMatchObject({ kind: basalt.code, depth: units(1), altered: 3 });
  expect(readLayer(map, 1, 1)).toMatchObject({ kind: shale.code, depth: units(3) });
  releaseHeldRock(map, held);
});
it("rotates axial fabric with material deformation while leaving pure translation unchanged", () => {
  expect(deformFabric(1, 0, [1, 0, 0, 1])).toEqual([1, 0]);
  const [x, y] = deformFabric(1, 0, [0, -1, 1, 0]);
  expect(x).toBeCloseTo(-1);
  expect(y).toBeCloseTo(0);
  const map = ground();
  deformGround(map, 0, [0, -1, 1, 0]);
  expect(readLayer(map, 0, 0).grainX).toBeCloseTo(-1);
  expect(readLayer(map, 0, 0).altered).toBe(3);
});

it("lands land and cut cover above former height ceilings with their retained beds", () => {
  const map = ground();
  openCut(map, 0, 0.5);
  setLayer(map, 0, 0, basalt.code, units(4), { altered: 1 }, "loose");
  setLayer(map, 0, 1, shale.code, units(6), { altered: 2 }, "loose");
  setLayer(map, 0, 0, granite.code, units(8), { altered: 3 }, "cutLoose");
  setLayer(map, 0, 1, shale.code, units(10), { altered: 4 }, "cutLoose");
  map.BedrockElevation.set(1, units(20_000));
  projectGround(map, 1);
  const held = holdRock(map);
  accreteHeldCover(map, held, 1, 0, 1);
  expect(readLayer(map, 1, 0, "loose")).toMatchObject({
    kind: granite.code,
    depth: units(4),
    altered: 3,
  });
  expect(readLayer(map, 1, 1, "loose")).toMatchObject({
    kind: shale.code,
    depth: units(5),
    altered: 4,
  });
  expect(readLayer(map, 1, 2, "loose")).toMatchObject({
    kind: basalt.code,
    depth: units(2),
    altered: 1,
  });
  expect(readLayer(map, 1, 3, "loose")).toMatchObject({
    kind: shale.code,
    depth: units(3),
    altered: 2,
  });
  releaseHeldRock(map, held);
});

it("lands incoming rock on high ground and buries its existing cover", () => {
  const map = ground();
  map.CompletedEpochCount = 9;
  map.BedrockElevation.set(1, units(100_000));
  setLayer(map, 1, 0, shale.code, units(8), { formedMin: 2, altered: 4 }, "loose");
  projectGround(map, 1);
  const held = holdRock(map),
    crust = map.CrustThickness.get(1),
    surface = map.Elevation.get(1);
  expect(accreteHeldGround(map, held, 1, 0, units(40))).toBe(units(40));
  expect(map.CrustThickness.get(1)).toBe(crust);
  expect(map.Elevation.get(1)).toBe(surface + units(40));
  expect(map.SedimentThickness.get(1)).toBe(0);
  expect(readLayer(map, 1, 2)).toMatchObject({
    kind: shale.code,
    depth: units(8),
    formedMin: 2,
    altered: 9,
  });
  expect(readLayer(map, 1, 0).kind).toBe(basalt.code);
  releaseHeldRock(map, held);
});

it("buries each facet's cover before collision beds while preserving substantial inherited contacts", () => {
  const map = ground(),
    { tufa, rimerot, sandstone, limestone, quartzite, gneiss } = rockCatalogue,
    kinds = [tufa, rimerot, sandstone, shale, limestone, basalt, quartzite, granite];
  kinds.forEach((kind, slot) =>
    setLayer(map, 1, slot, kind.code, units(slot < 2 ? 0.5 : (slot - 1) * 100), {
      formedMin: 5,
      formedMax: 5,
    })
  );
  openCut(map, 1, 0.25);
  setLayer(map, 1, 0, gneiss.code, units(1), { formedMin: 8, formedMax: 8 }, "loose");
  setLayer(map, 1, 1, sandstone.code, units(2.5), { formedMin: 7, formedMax: 7 }, "loose");
  setLayer(map, 1, 0, limestone.code, units(4), { formedMin: 6, formedMax: 6 }, "cutLoose");
  map.CompletedEpochCount = 9;
  projectGround(map, 1);
  const before = map.Elevation.get(1),
    held = holdRock(map),
    merges: MaterialLayer[] = [],
    stop = watchColumn({ fold() {}, strip() {}, merge: (_, __, ___, layer) => merges.push(layer) });
  try {
    accreteHeldGround(map, held, 1, 0, units(40));
    for (const [facet, mixtureDepth] of [
      ["land", 34.5],
      ["cut", 35],
    ] as const) {
      expect(readLayer(map, 1, 0, facet)).toMatchObject({ kind: basalt.code, depth: units(10) });
      expect(readLayer(map, 1, 1, facet)).toMatchObject({
        depth: units(mixtureDepth),
        mixed: 1,
        altered: 9,
      });
      expect(readLayer(map, 1, 2, facet)).toMatchObject({
        kind: sandstone.code,
        depth: units(100),
        formedMin: 5,
        mixed: 0,
      });
    }
    expect(map.SedimentThickness.get(1)).toBe(0);
    expect(map.Elevation.get(1)).toBe(before + units(40));
    expect(map.GroundCutDepth.get(1)).toBe(units(-0.5));
    expect(merges.some((layer) => layer.formedMax === 8 && layer.altered === 9)).toBe(true);
    withdrawColumn(map, 1, "land", units(44.5));
    expect(readLayer(map, 1, 0)).toMatchObject({ kind: sandstone.code, depth: units(100) });
    expect(heldLayers(held, 0)[0]).toMatchObject({ kind: basalt.code, altered: 3 });
  } finally {
    stop();
    releaseHeldRock(map, held);
  }
});
