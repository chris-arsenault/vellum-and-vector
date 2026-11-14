import { expect, it } from "vitest";
import {
  arriveInColumn,
  fitColumn,
  overlayColumn,
  partColumn,
  reExposeColumn,
  renameInColumn,
  settleColumn,
  type IdentityLayer,
} from "./identityColumn";

const layer = (people: number, tongue: number, rest: Partial<IdentityLayer> = {}) => ({
  people,
  hardness: 0,
  age: 0,
  tongue,
  faith: 0,
  custom: 0,
  allegiance: 0,
  craft: 0,
  ...rest,
});
const held = (column: IdentityLayer[]) => column.map(({ people, tongue }) => [tongue, people]);

it("lays a new layer over the old, taken up least by the hardened", () => {
  const column = [layer(100, 1, { hardness: 0.75 }), layer(100, 2)];
  const taken = overlayColumn(column, { tongue: 3, faith: 0, custom: 0, allegiance: 0 }, 50);
  // It reaches a quarter of each layer; three in four of the hardened it reaches refuse.
  expect(taken).toBe(31.25);
  expect(held(column)).toEqual([
    [3, 31.25],
    [1, 93.75],
    [2, 75],
  ]);
});
it("changes only the traditions a new layer names, so a faith spreads without a tongue", () => {
  const column = [layer(60, 1, { faith: 7 }), layer(40, 2, { faith: 7 })];
  overlayColumn(column, { faith: 9 }, 50);
  expect(column.map(({ tongue, faith, people }) => [tongue, faith, people])).toEqual([
    [1, 9, 30],
    [2, 9, 20],
    [1, 7, 30],
    [2, 7, 20],
  ]);
  // Those who already hold what is named give nobody to it.
  expect(overlayColumn([layer(10, 1, { faith: 9 })], { faith: 9 }, 5)).toBe(0);
});
it("cannot overlay more people than are open to it, and takes up those who hold nothing", () => {
  const column = [layer(100, 1, { hardness: 1 })];
  const traditions = { tongue: 2, faith: 0, custom: 0, allegiance: 0 };
  expect(overlayColumn(column, traditions, 40)).toBe(0);
  // Of 40 reached among 125, only the fifth who hold nothing yet are open to it.
  expect(overlayColumn(column, traditions, 40, 0, 25)).toBe(8);
  expect(held(column)).toEqual([
    [2, 8],
    [1, 100],
  ]);
});
it("joins arrivals to the layer that names the same traditions wherever it lies", () => {
  const column = [layer(10, 1), layer(30, 2, { age: 100 })];
  arriveInColumn(column, [layer(10, 2, { age: 0 }), layer(5, 4)]);
  expect(held(column)).toEqual([
    [4, 5],
    [1, 10],
    [2, 40],
  ]);
  expect(column[2].age).toBe(75);
});
it("parts a share of every layer and leaves the rest in place", () => {
  const column = [layer(40, 1), layer(60, 2)];
  expect(held(partColumn(column, 0.25))).toEqual([
    [1, 10],
    [2, 15],
  ]);
  expect(held(column)).toEqual([
    [1, 30],
    [2, 45],
  ]);
});
it("re-exposes the layer beneath, which takes back those who leave the newest", () => {
  const column = [layer(20, 3), layer(50, 1), layer(30, 2)];
  reExposeColumn(column, 20);
  expect(held(column)).toEqual([
    [1, 70],
    [2, 30],
  ]);
});
it("keeps no more layers than a cell can hold, losing the thinnest into the one beneath", () => {
  const column = [layer(50, 1), layer(2, 2), layer(40, 3), layer(30, 4), layer(20, 5)];
  settleColumn(column);
  expect(held(column)).toEqual([
    [1, 50],
    [3, 42],
    [4, 30],
    [5, 20],
  ]);
});
it("loses the thinnest layer of a full column into the layer most like it", () => {
  const column = [
    layer(50, 1, { faith: 1 }),
    layer(40, 2, { faith: 1 }),
    layer(30, 3, { faith: 2 }),
    layer(20, 4, { faith: 2 }),
    // A few who share a tongue with the layer far below them, not with the one beneath.
    layer(2, 1, { faith: 3 }),
  ];
  settleColumn(column);
  expect(column.map(({ tongue, faith, people }) => [tongue, faith, people])).toEqual([
    [1, 1, 52],
    [2, 1, 40],
    [3, 2, 30],
    [4, 2, 20],
  ]);
});
it("renames a tradition for everyone who holds it, however set, and joins what now matches", () => {
  const column = [layer(30, 1, { hardness: 1 }), layer(20, 2), layer(10, 3)];
  renameInColumn(column, "tongue", 1, 2);
  expect(held(column)).toEqual([
    [2, 50],
    [3, 10],
  ]);
});
it("scales a column to the people left alive, keeping each layer's share", () => {
  const column = [layer(60, 1), layer(40, 2)];
  fitColumn(column, 50);
  expect(held(column)).toEqual([
    [1, 30],
    [2, 20],
  ]);
});
