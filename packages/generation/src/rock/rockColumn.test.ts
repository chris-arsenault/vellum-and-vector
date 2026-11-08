import { expect, it } from "vitest";
import { createTestField as createField } from "./groundTestFixture";
import { createMesh } from "../world/mesh";
import { rockCatalogue } from "./rockCatalogue";
import {
  alterTop,
  changeLayer,
  allColumnFields,
  copyLayer,
  deepestLayer,
  intrudeBasement,
  layDownRock,
  layDownPackage,
  layerDepth,
  layerKind,
  materialLayer,
  mergeMaterial,
  rockColumnFields,
  rockLayers,
  readLayer,
  setLayer,
  shuffleLayers,
  stripRock,
  watchColumn,
} from "./rockColumn";
import { atlasChannels, structureChannels } from "../world/atlasChannels";

const { shale, sandstone, limestone, gneiss, tufa, rimerot } = rockCatalogue,
  nativeBindingNames = atlasChannels.map(({ name }) => name);
function column() {
  const map = createField(createMesh(4, 1));
  setLayer(map, 0, 0, shale.code, 100);
  setLayer(map, 0, 1, sandstone.code, 200);
  setLayer(map, 0, 2, limestone.code, 300);
  setLayer(map, 0, 3, gneiss.code, 5000);
  map.RockKindCodes.set(0, shale.code);
  map.RockResistance.set(0, shale.resistance);
  return map;
}
const kinds = (map: ReturnType<typeof column>) =>
  Array.from({ length: rockLayers }, (_, layer) => layerKind(map, 0, layer));

it("thins the top layer without uncovering anything until it is gone", () => {
  const map = column();
  stripRock(map, 0, 40);
  expect(layerKind(map, 0, 0)).toBe(shale.code);
  expect(layerDepth(map, 0, 0)).toBe(60);
  expect(map.RockResistance.get(0)).toBe(shale.resistance);
});

it("uncovers each layer in turn and takes on its resistance", () => {
  const map = column();
  stripRock(map, 0, 350);
  expect(layerKind(map, 0, 0)).toBe(limestone.code);
  expect(layerDepth(map, 0, 0)).toBe(250);
  expect(map.RockKindCodes.get(0)).toBe(limestone.code);
  expect(map.RockResistance.get(0)).toBe(limestone.resistance);
});

it("keeps alteration on its own bed rather than giving it to the newly exposed bed", () => {
  const map = column();
  setLayer(map, 0, 0, shale.code, 100, { strength: shale.resistance + 300, altered: 2 });
  const before = readLayer(map, 0, 0);
  stripRock(map, 0, 100);
  expect(map.RockResistance.get(0)).toBe(sandstone.resistance);
  expect(readLayer(map, 0, 0).altered).toBe(0);
  expect(before.strength).toBe(shale.resistance + 300);
});

it("never runs out of basement", () => {
  const map = column();
  stripRock(map, 0, 1_000_000);
  expect(layerKind(map, 0, 0)).toBe(gneiss.code);
  expect(layerDepth(map, 0, 0)).toBe(1);
  layDownRock(map, 0, tufa, 10);
  stripRock(map, 0, 20);
  expect(layerKind(map, 0, 0)).toBe(gneiss.code);
});

it("keeps every layer apart while the column has room", () => {
  const map = column();
  layDownRock(map, 0, tufa, 10);
  expect(kinds(map).slice(0, 5)).toEqual([
    tufa.code,
    shale.code,
    sandstone.code,
    limestone.code,
    gneiss.code,
  ]);
  expect(deepestLayer(map, 0)).toBe(4);
  expect(map.RockResistance.get(0)).toBe(tufa.resistance);
});

it("coarsens an internal contact while preserving the cap and basement", () => {
  const map = column(),
    laid = [tufa, rimerot, tufa, rimerot, tufa];
  laid.forEach((rock) => layDownRock(map, 0, rock, 10));
  expect(deepestLayer(map, 0)).toBe(rockLayers - 1);
  expect(layerKind(map, 0, rockLayers - 1)).toBe(gneiss.code);
  expect(layerDepth(map, 0, rockLayers - 1)).toBe(5000);
  expect(layerKind(map, 0, 0)).toBe(tufa.code);
  expect(Array.from({ length: rockLayers }, (_, at) => readLayer(map, 0, at).mixed)).toContain(1);
});

it("inserts a whole package in burial order while retaining its cap, basement and mixed history", () => {
  const map = column(),
    folds: number[] = [],
    mergedAges: number[][] = [];
  for (let slot = 0; slot < 3; slot++) {
    const bed = readLayer(map, 0, slot);
    setLayer(map, 0, slot, bed.kind, bed.depth, { formedMin: slot + 1, formedMax: slot + 1 });
  }
  const incoming = Array.from({ length: 6 }, (_, slot) =>
    materialLayer(slot % 2 ? rimerot.code : tufa.code, slot + 1, {
      formedMin: 8,
      formedMax: 9,
      altered: 10,
      grainY: 0.6,
    })
  );
  const stop = watchColumn({
    fold: (_cell, _kind, _into, _thickness, above) => folds.push(above),
    strip() {},
    merge: (_cell, _column, _layer, result) => {
      mergedAges.push([result.formedMin, result.formedMax]);
      Reflect.set(result, "formedMin", -999);
    },
  });
  layDownPackage(map, 0, "land", incoming);
  stop();
  expect(readLayer(map, 0, 0)).toMatchObject({
    kind: tufa.code,
    depth: 1,
    formedMin: 8,
    altered: 10,
    grainY: 0.6,
  });
  expect(readLayer(map, 0, 3)).toMatchObject({ kind: rimerot.code, depth: 6, mixed: 0 });
  expect(readLayer(map, 0, 5)).toMatchObject({ kind: sandstone.code, formedMin: 2, mixed: 0 });
  expect(readLayer(map, 0, 6)).toMatchObject({ kind: limestone.code, formedMin: 3, mixed: 0 });
  expect(readLayer(map, 0, 7)).toMatchObject({ kind: gneiss.code, depth: 5000, mixed: 0 });
  expect(folds).toEqual([2, 1]);
  expect(mergedAges).toEqual([
    [8, 9],
    [8, 9],
  ]);
  stripRock(map, 0, 1);
  expect(readLayer(map, 0, 0)).toMatchObject({ kind: rimerot.code, depth: 9, altered: 10 });
});

it("keeps finite package cover ordered without treating its bottom as infinite basement", () => {
  const map = column();
  layDownPackage(map, 0, "loose", [
    materialLayer(tufa.code, 1, { formedMin: 4, formedMax: 4 }),
    materialLayer(rimerot.code, 2, { formedMin: 3, formedMax: 3 }),
    materialLayer(shale.code, 3, { formedMin: 2, formedMax: 2 }),
    materialLayer(sandstone.code, 4, { formedMin: 1, formedMax: 1 }),
    materialLayer(limestone.code, 5, { formedMin: 0, formedMax: 0 }),
  ]);
  expect(readLayer(map, 0, 0, "loose")).toMatchObject({ kind: tufa.code, depth: 1 });
  expect(readLayer(map, 0, 1, "loose")).toMatchObject({ mixed: 1, formedMin: 2, formedMax: 3 });
  expect(readLayer(map, 0, 3, "loose")).toMatchObject({ kind: limestone.code, depth: 5 });
  stripRock(map, 0, 100, "loose");
  expect(readLayer(map, 0, 0, "loose").depth).toBe(0);
  expect(readLayer(map, 0, 0).kind).toBe(shale.code);
});

it("retains thin deposits as their own material rather than relabeling them as substrate", () => {
  const map = column();
  layDownRock(map, 0, tufa, 5 * 1024);
  expect(layerKind(map, 0, 0)).toBe(tufa.code);
  expect(layerDepth(map, 0, 0)).toBe(5 * 1024);
  layDownRock(map, 0, tufa, 50 * 1024);
  expect(layerKind(map, 0, 0)).toBe(tufa.code);
});
it("cools melt below a shell, so it reaches the surface only once the shell has worn away", () => {
  const map = createField(createMesh(4, 1));
  setLayer(map, 0, 0, rockCatalogue.basalt.code, 8000);
  map.RockKindCodes.set(0, rockCatalogue.basalt.code);
  intrudeBasement(map, 0, rockCatalogue.granite, 3000);
  expect(kinds(map).slice(0, 2)).toEqual([rockCatalogue.basalt.code, rockCatalogue.granite.code]);
  expect(layerDepth(map, 0, 0)).toBe(3000);
  stripRock(map, 0, 3500);
  expect(map.RockKindCodes.get(0)).toBe(rockCatalogue.granite.code);
  const layered = column();
  intrudeBasement(layered, 0, rockCatalogue.granite, 3000);
  expect(layerKind(layered, 0, 0)).toBe(shale.code);
  expect(layerKind(layered, 0, 3)).toBe(rockCatalogue.granite.code);
});
it("reports rock a full column loses, and how deep it lay, and nothing until it is full", () => {
  const map = column(),
    folds: { kind: number; into: number; thickness: number; above: number }[] = [],
    stripped: number[] = [];
  const stop = watchColumn({
    fold: (_cell, kind, into, thickness, above) => folds.push({ kind, into, thickness, above }),
    strip: (_cell, amount) => stripped.push(amount),
  });
  [tufa, rimerot, tufa].forEach((rock) => layDownRock(map, 0, rock, 10));
  expect(folds).toEqual([]);
  [rimerot, tufa, rimerot].forEach((rock) => layDownRock(map, 0, rock, 10));
  stripRock(map, 0, 5);
  stop();
  expect(folds.length).toBeGreaterThan(0);
  expect(folds[0].thickness).toBeGreaterThan(0);
  expect(folds[0].above).toBeGreaterThan(0);
  expect(stripped).toEqual([5]);
});

it("gives every layer of the column a field band and a channel to carry it", () => {
  const map = column();
  for (const name of rockColumnFields) expect(map[name]).toBeDefined();
  for (const name of allColumnFields) expect(map[name]).toBeDefined();
  expect(rockColumnFields.length).toBe(2 * rockLayers);
  for (let layer = 0; layer < rockLayers; layer++) {
    expect(structureChannels).toContain(`rockLayer${layer}`);
    expect(structureChannels).toContain(`rockDepth${layer}`);
    expect(nativeBindingNames).toContain(`rockLayer${layer}`);
    expect(nativeBindingNames).toContain(`rockDepth${layer}`);
  }
});

it("keeps the intact cap while a separate cut reaches its own buried bed", () => {
  const map = column();
  setLayer(map, 0, 0, shale.code, 100, {
    strength: 850,
    damage: 0.2,
    grainX: 0.7,
    formedMin: 1,
    formedMax: 2,
  });
  for (let at = 0; at < rockLayers; at++) copyLayer(map, 0, at, at, "cut", "land");
  stripRock(map, 0, 350, "cut");
  expect(readLayer(map, 0, 0).kind).toBe(shale.code);
  expect(readLayer(map, 0, 0).strength).toBe(850);
  expect(readLayer(map, 0, 0, "cut").kind).toBe(limestone.code);
  layDownRock(map, 0, tufa, 5, { altered: 4 }, "cut");
  expect(readLayer(map, 0, 0, "cut").altered).toBe(4);
  expect(readLayer(map, 0, 0).formedMin).toBe(1);
});

it("carries finite loose cover with its bed order and alteration through burial and exposure", () => {
  const map = column();
  layDownRock(
    map,
    0,
    sandstone,
    30,
    { strength: 1400, damage: 0.3, grainY: 0.4, formedMin: 2, formedMax: 3, altered: 4 },
    "loose"
  );
  layDownRock(map, 0, shale, 50, {}, "loose");
  stripRock(map, 0, 50, "loose");
  expect(readLayer(map, 0, 0, "loose")).toMatchObject({
    kind: sandstone.code,
    depth: 30,
    strength: 1400,
    damage: 0.3,
    grainY: 0.4,
    formedMin: 2,
    formedMax: 3,
    altered: 4,
  });
  expect(stripRock(map, 0, 100, "loose")).toBe(30);
  expect(layerDepth(map, 0, 0, "loose")).toBe(0);
  expect(stripRock(map, 0, 100, "loose")).toBe(0);
});

it("marks mixed contacts and retains the largest constituent identities and age range", () => {
  const first = materialLayer(shale.code, 2, { formedMin: 1, formedMax: 2 }),
    second = materialLayer(limestone.code, 1, { formedMin: 4, formedMax: 4 }),
    mixed = mergeMaterial(first, second),
    result = mergeMaterial(mixed, materialLayer(tufa.code, 4, { altered: 6 }));
  expect(mixed.secondaryShare).toBeCloseTo(1 / 3);
  expect(result).toMatchObject({
    kind: tufa.code,
    secondaryKind: shale.code,
    formedMin: 0,
    formedMax: 4,
    altered: 6,
    mixed: 1,
  });
  expect(result.secondaryShare).toBeCloseTo(1 / 3);
  expect(result.strength).toBeGreaterThan(shale.resistance);
});

it("does not inherit the age of exhausted cover when the same material arrives again", () => {
  const map = column();
  layDownRock(map, 0, shale, 30, { formedMin: 1, formedMax: 1 }, "loose");
  stripRock(map, 0, 30, "loose");
  layDownRock(map, 0, shale, 20, { formedMin: 7, formedMax: 7 }, "loose");
  expect(readLayer(map, 0, 0, "loose")).toMatchObject({ depth: 20, formedMin: 7, formedMax: 7 });
});

it("applies whole-ground alterations to each occupied facet while explicit facets stay local", () => {
  const map = column();
  map.GroundCutShare.set(0, 0.4);
  for (let slot = 0; slot < rockLayers; slot++) copyLayer(map, 0, slot, slot, "cut", "land");
  alterTop(map, 0, rimerot, 40);
  expect(readLayer(map, 0, 0, "land").kind).toBe(rimerot.code);
  expect(readLayer(map, 0, 0, "cut").kind).toBe(rimerot.code);
  changeLayer(map, 0, 0, tufa, "cut");
  expect(readLayer(map, 0, 0, "land").kind).toBe(rimerot.code);
  expect(readLayer(map, 0, 0, "cut").kind).toBe(tufa.code);
  shuffleLayers(map, 0, 0.2);
  expect(readLayer(map, 0, 0, "land").kind).toBe(shale.code);
  expect(readLayer(map, 0, 0, "cut").kind).toBe(shale.code);
  intrudeBasement(map, 0, rockCatalogue.granite, 3000);
  expect(readLayer(map, 0, deepestLayer(map, 0), "land").kind).toBe(rockCatalogue.granite.code);
  expect(readLayer(map, 0, deepestLayer(map, 0, "cut"), "cut").kind).toBe(
    rockCatalogue.granite.code
  );
});

it("thickens the top layer when the same rock is laid on it", () => {
  const map = column();
  layDownRock(map, 0, shale, 25);
  expect(layerDepth(map, 0, 0)).toBe(125);
  expect(kinds(map)[1]).toBe(sandstone.code);
});

it("alters the top in place, using up what it turned", () => {
  const map = column();
  alterTop(map, 0, rimerot, 40);
  expect(kinds(map).slice(0, 2)).toEqual([rimerot.code, shale.code]);
  expect(layerDepth(map, 0, 0)).toBe(40);
  expect(layerDepth(map, 0, 1)).toBe(60);
});

it("retains the age interval of every bed a deeper alteration transforms", () => {
  const map = column();
  setLayer(map, 0, 0, shale.code, 100, { formedMin: 4, formedMax: 4 });
  setLayer(map, 0, 1, sandstone.code, 200, { formedMin: 1, formedMax: 2 });
  map.CompletedEpochCount = 6;
  alterTop(map, 0, rimerot, 150);
  expect(readLayer(map, 0, 0)).toMatchObject({
    kind: rimerot.code,
    depth: 150,
    formedMin: 1,
    formedMax: 4,
    altered: 6,
  });
  expect(readLayer(map, 0, 1)).toMatchObject({ kind: sandstone.code, depth: 150, formedMin: 1 });
});

it("shuffles layers out of order and exposes what comes up", () => {
  const map = column();
  shuffleLayers(map, 0, 0.2);
  expect(kinds(map).slice(0, 2)).toEqual([sandstone.code, shale.code]);
  expect(map.RockKindCodes.get(0)).toBe(sandstone.code);
  shuffleLayers(map, 0, 0.8);
  expect(kinds(map).slice(1, 3)).toEqual([limestone.code, shale.code]);
  expect(map.RockKindCodes.get(0)).toBe(sandstone.code);
});

it("keeps a thin column's basement when rock is laid over it", () => {
  const map = createField(createMesh(4, 1));
  setLayer(map, 0, 0, gneiss.code, 5000);
  map.RockLayerKind0.set(0, gneiss.code);
  for (const kind of [shale, sandstone, limestone]) layDownRock(map, 0, kind, 10);
  expect(layerKind(map, 0, 3)).toBe(gneiss.code);
  expect(layerDepth(map, 0, 3)).toBe(5000);
});
