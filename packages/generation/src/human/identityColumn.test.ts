import { expect, it } from "vitest";
import {
  arriveInColumn,
  fitColumn,
  overlayColumn,
  partColumn,
  reExposeColumn,
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
  ...rest,
});
const held = (column: IdentityLayer[]) => column.map(({ people, tongue }) => [tongue, people]);

it("lays a new layer over the old, taken up least by the hardened", () => {
  const column = [layer(100, 1, { hardness: 0.75 }), layer(100, 2)];
  const taken = overlayColumn(column, { tongue: 3, faith: 0, custom: 0, allegiance: 0 }, 50);
  expect(taken).toBe(50);
  // The hardened layer offers a quarter of its people, the open one all of them.
  expect(held(column)).toEqual([
    [3, 50],
    [1, 90],
    [2, 60],
  ]);
});
it("cannot overlay more people than are open to it, and takes up those who hold nothing", () => {
  const column = [layer(100, 1, { hardness: 1 })];
  const traditions = { tongue: 2, faith: 0, custom: 0, allegiance: 0 };
  expect(overlayColumn(column, traditions, 40)).toBe(0);
  expect(overlayColumn(column, traditions, 40, 0, 25)).toBe(25);
  expect(held(column)).toEqual([
    [2, 25],
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
it("scales a column to the people left alive, keeping each layer's share", () => {
  const column = [layer(60, 1), layer(40, 2)];
  fitColumn(column, 50);
  expect(held(column)).toEqual([
    [1, 30],
    [2, 20],
  ]);
});
