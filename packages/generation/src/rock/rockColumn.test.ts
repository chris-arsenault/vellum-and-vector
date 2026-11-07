import { expect, it } from "vitest";
import { createField } from "../canonry/field";
import { createMesh } from "../canonry/mesh";
import { rockCatalogue } from "./rockCatalogue";
import {
  alterTop,
  deepestLayer,
  intrudeBasement,
  layBed,
  layDownRock,
  layerDepth,
  layerKind,
  overthrust,
  rockColumnFields,
  rockLayers,
  setLayer,
  shuffleLayers,
  stripRock,
  watchColumn,
} from "./rockColumn";
import { atlasChannels, structureChannels } from "../canonry/atlasChannels";

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

it("keeps what was done to the old surface when a new rock is uncovered", () => {
  const map = column();
  map.RockResistance.set(0, shale.resistance + 300);
  stripRock(map, 0, 100);
  expect(map.RockResistance.get(0)).toBe(sandstone.resistance + 300);
});

it("never runs out of basement", () => {
  const map = column();
  stripRock(map, 0, 1_000_000);
  expect(layerKind(map, 0, 0)).toBe(gneiss.code);
  expect(layerDepth(map, 0, 0)).toBe(0);
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

it("folds into the basement only once the column is full", () => {
  const map = column(),
    laid = [tufa, rimerot, tufa, rimerot, tufa];
  laid.forEach((rock) => layDownRock(map, 0, rock, 10));
  expect(deepestLayer(map, 0)).toBe(rockLayers - 1);
  expect(layerKind(map, 0, rockLayers - 1)).toBe(gneiss.code);
  expect(layerDepth(map, 0, rockLayers - 1)).toBe(5300);
});

it("lets a bed too thin to be a cell's ground add to what is there, and a thick one lie on it", () => {
  const map = column();
  layBed(map, 0, tufa, 5 * 1024);
  expect(layerKind(map, 0, 0)).toBe(shale.code);
  expect(layerDepth(map, 0, 0)).toBe(100 + 5 * 1024);
  layBed(map, 0, tufa, 50 * 1024);
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
  expect(rockColumnFields.length).toBe(2 * rockLayers);
  for (let layer = 0; layer < rockLayers; layer++) {
    expect(structureChannels).toContain(`rockLayer${layer}`);
    expect(structureChannels).toContain(`rockDepth${layer}`);
    expect(nativeBindingNames).toContain(`rockLayer${layer}`);
    expect(nativeBindingNames).toContain(`rockDepth${layer}`);
  }
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

it("lays a riding sheet over the column, its own order kept and cut at the sheet's floor", () => {
  const map = column();
  overthrust(map, 0, [
    { kind: limestone.code, depth: 100 },
    { kind: gneiss.code, depth: 30_000 * 1024 },
  ]);
  expect(layerKind(map, 0, 0)).toBe(limestone.code);
  expect(layerKind(map, 0, 1)).toBe(gneiss.code);
  expect(layerDepth(map, 0, 1)).toBeLessThan(30_000 * 1024);
  expect(layerKind(map, 0, 2)).toBe(shale.code);
});
