import { expect, it, vi } from "vitest";
import { coarsenBulk } from "./rockCoarsening";
import { materialLayer, type MaterialLayer, type Column } from "./rockLayerFields";
import { rockCatalogue } from "./rockCatalogue";

const { shale, sandstone, limestone, gneiss, tufa } = rockCatalogue;
function observer() {
  return { fold: vi.fn(), strip: vi.fn(), merge: vi.fn() };
}
const layer = (kind: number, depth: number, age = 0) =>
  materialLayer(kind, depth, { mixed: 1, formedMin: age, formedMax: age });

it("prefers equivalent buried material to a thinner unlike contact and retains formation history", () => {
  const layers = [
      layer(gneiss.code, 1),
      layer(shale.code, 20, 2),
      layer(shale.code, 30, 7),
      layer(sandstone.code, 1),
      layer(limestone.code, 1),
      layer(gneiss.code, 100),
    ],
    watcher = observer();
  coarsenBulk(layers, 7, "land", 5, true, [watcher]);
  expect(watcher.fold).toHaveBeenCalledWith(7, shale.code, shale.code, 20, 1);
  expect(layers[1]).toMatchObject({ depth: 50, formedMin: 2, formedMax: 7, mixed: 1 });
  expect(watcher.merge.mock.calls[0].slice(0, 3)).toEqual([7, "land", 1]);
  expect(watcher.merge.mock.calls[0][3]).not.toBe(layers[1]);
});

it("keeps the cap and basement while equal-depth contacts select the deepest eligible pair", () => {
  const cap = layer(shale.code, 0.1),
    basement = layer(shale.code, 0.1),
    layers = [
      cap,
      layer(sandstone.code, 2),
      layer(limestone.code, 2),
      layer(gneiss.code, 2),
      layer(tufa.code, 2),
      basement,
    ],
    watcher = observer();
  coarsenBulk(layers, 3, "land", 5, true, [watcher]);
  expect(watcher.merge.mock.calls[0].slice(0, 3)).toEqual([3, "land", 3]);
  expect(watcher.fold.mock.calls[0].slice(3)).toEqual([2, 4.1]);
  expect(layers[0]).toBe(cap);
  expect(layers.at(-1)).toBe(basement);
  expect(layers[3].depth).toBe(4);
});

it("refreshes both neighboring contacts and reports current layer ranks through successive folds", () => {
  const layers = [
      layer(gneiss.code, 10),
      layer(shale.code, 1, 1),
      layer(shale.code, 1, 2),
      layer(shale.code, 1, 3),
      layer(sandstone.code, 10),
      layer(limestone.code, 10),
      layer(gneiss.code, 100),
    ],
    watcher = observer();
  coarsenBulk(layers, 8, "cut", 4, true, [watcher]);
  expect(watcher.merge.mock.calls.map((args) => args[2])).toEqual([2, 1, 1]);
  expect(watcher.fold.mock.calls.map((args) => args[4])).toEqual([11, 10, 10]);
  expect(watcher.merge.mock.calls.map((args) => args[3].depth)).toEqual([2, 3, 13]);
  expect(layers[1]).toMatchObject({ formedMin: 0, formedMax: 3, mixed: 1 });
});

it.each(["loose", "cutLoose"] as Column[])("lets %s fold the deepest finite contact", (column) => {
  const cap = layer(gneiss.code, 0.1),
    layers = [
      cap,
      layer(shale.code, 10),
      layer(sandstone.code, 10),
      layer(limestone.code, 1),
      layer(tufa.code, 1),
    ],
    watcher = observer();
  coarsenBulk(layers, 0, column, 4, false, [watcher]);
  expect(watcher.merge.mock.calls[0][2]).toBe(3);
  expect(layers[0]).toBe(cap);
  expect(layers[3].depth).toBe(2);
});

it("does not treat an altered bed or a different deposited bed as equivalent", () => {
  const layers = [
      layer(gneiss.code, 10),
      layer(shale.code, 10),
      { ...layer(shale.code, 10), deposited: 2 },
      { ...layer(shale.code, 10), deposited: 2, altered: 3 },
      layer(limestone.code, 1),
      layer(tufa.code, 1),
      layer(gneiss.code, 100),
    ],
    watcher = observer();
  coarsenBulk(layers, 0, "land", 6, true, [watcher]);
  expect(watcher.merge.mock.calls[0][2]).toBe(4);
});

it("leaves completed folds as ordinary layers when an observer stops a later fold", () => {
  const layers: MaterialLayer[] = [
      layer(gneiss.code, 10),
      layer(shale.code, 1),
      layer(shale.code, 1),
      layer(shale.code, 1),
      layer(sandstone.code, 10),
      layer(limestone.code, 10),
      layer(gneiss.code, 100),
    ],
    watcher = observer();
  watcher.merge
    .mockImplementationOnce(() => {})
    .mockImplementationOnce(() => {
      throw Error("stop");
    });
  expect(() => coarsenBulk(layers, 0, "land", 4, true, [watcher])).toThrow("stop");
  expect(layers).toHaveLength(6);
  expect(layers[2].depth).toBe(2);
});
