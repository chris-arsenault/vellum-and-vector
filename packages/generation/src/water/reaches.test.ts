import { expect, it } from "vitest";
import {
  carryReaches,
  emptyReaches,
  leftCourses,
  reachOfCells,
  regimeOf,
  sameCourse,
  type ReachCut,
  type ReachStore,
} from "./reaches";

const cut = (cells: number[], more: Partial<ReachCut> = {}): ReachCut => ({
  cells,
  order: 1,
  flow: 50,
  least: 20,
  flood: 90,
  months: 12,
  downstream: null,
  ...more,
});
const courses = (store: ReachStore) =>
  [...store.reaches.values()].map(({ id, cells, dry }) => [id, cells, dry]);
/** Names a reach as the end of a drawn river, as publishing does. */
const name = (store: ReachStore, id: number, river: string) =>
  (store.reaches.get(id)!.river = river);

it("gives each river an identity the first time it is seen, and keeps it while it runs", () => {
  const store = emptyReaches();
  carryReaches(store, [cut([1, 2, 3]), cut([7, 8, 9])], 0);
  expect(courses(store)).toEqual([
    [1, [1, 2, 3], false],
    [2, [7, 8, 9], false],
  ]);
  // The same rivers next pass, worked out in the other order, are the same rivers.
  carryReaches(store, [cut([7, 8, 9]), cut([1, 2, 3])], 0);
  expect(store.reaches.get(1)!.cells).toEqual([1, 2, 3]);
  expect(store.reaches.get(2)!.cells).toEqual([7, 8, 9]);
  expect(store.reaches.size).toBe(2);
});

it("keeps a river that shifts part of its course, and remembers the ground it left", () => {
  const store = emptyReaches();
  carryReaches(store, [cut([1, 2, 3, 4, 5, 6])], 2);
  // Its lower end breaks out to new ground.
  carryReaches(store, [cut([1, 2, 3, 4, 15, 16])], 2);
  const river = store.reaches.get(1)!;
  expect(river.cells).toEqual([1, 2, 3, 4, 15, 16]);
  expect(river.dry).toBe(false);
  expect(river.former).toEqual([{ cells: [5, 6], leftIn: 2 }]);
  expect(store.reaches.size).toBe(1);
});

it("keeps a river that has lost its water as a dry course, and revives it by the same name", () => {
  const store = emptyReaches();
  carryReaches(store, [cut([1, 2, 3])], 3);
  name(store, 1, "the long river");
  carryReaches(store, [], 3);
  const dried = store.reaches.get(1)!;
  expect(dried.dry).toBe(true);
  expect(dried.cells).toEqual([1, 2, 3]);
  expect(dried.river).toBe("the long river");
  expect(dried.driedIn).toBe(3);
  expect(regimeOf(dried)).toBe("dry");
  // Water returns to the old bed: it is the same river.
  carryReaches(store, [cut([1, 2, 3], { months: 5 })], 4);
  const back = store.reaches.get(1)!;
  expect(back.dry).toBe(false);
  expect(back.river).toBe("the long river");
  expect(regimeOf(back)).toBe("seasonal");
});

it("makes a new river of water that takes a different valley, and dries the old one", () => {
  const store = emptyReaches();
  carryReaches(store, [cut([1, 2, 3, 4])], 0);
  carryReaches(store, [cut([21, 22, 23, 24])], 0);
  expect(store.reaches.get(1)!.dry).toBe(true);
  expect(store.reaches.get(2)!.cells).toEqual([21, 22, 23, 24]);
});

it("does not call running ground a former course when a new confluence cuts a river in two", () => {
  const store = emptyReaches();
  carryReaches(store, [cut([1, 2, 3, 4, 5, 6])], 0);
  // A tributary now joins at cell 4: the same water runs on, as two reaches.
  carryReaches(store, [cut([1, 2, 3], { downstream: 1 }), cut([4, 5, 6])], 0);
  const reaches = [...store.reaches.values()];
  expect(reaches.map(({ cells }) => cells)).toEqual([
    [1, 2, 3],
    [4, 5, 6],
  ]);
  expect(reaches.every(({ dry, former }) => !dry && former.length === 0)).toBe(true);
});

it("takes two reaches into one where a confluence is gone, keeping the river's name", () => {
  const store = emptyReaches();
  carryReaches(store, [cut([1, 2, 3], { downstream: 1 }), cut([4, 5])], 0);
  name(store, 2, "the long river");
  // The tributary that joined at cell 4 has dried: one reach now runs the whole way.
  carryReaches(store, [cut([1, 2, 3, 4, 5])], 0);
  expect(courses(store)).toEqual([[1, [1, 2, 3, 4, 5], false]]);
  expect(store.reaches.get(1)!.river).toBe("the long river");
});

it("leaves a long dry course whole when a short stretch of water crosses it", () => {
  const store = emptyReaches();
  carryReaches(store, [cut([1, 2, 3, 4, 5, 6])], 0);
  name(store, 1, "the long river");
  carryReaches(store, [], 0);
  carryReaches(store, [cut([3])], 0);
  const old = store.reaches.get(1)!;
  expect(old.dry).toBe(true);
  expect(old.cells).toEqual([1, 2, 3, 4, 5, 6]);
  expect(store.reaches.get(2)!.river).toBeUndefined();
});

it("forgets a dry course, and ground a river left, only when the ground no longer keeps it", () => {
  const store = emptyReaches();
  carryReaches(store, [cut([1, 2, 3, 4]), cut([7, 8, 9])], 0);
  carryReaches(store, [cut([1, 2, 3, 14])], 0);
  expect(store.reaches.get(1)!.former).toEqual([{ cells: [4], leftIn: 0 }]);
  expect(store.reaches.get(2)!.dry).toBe(true);
  // A later epoch: the ground keeps only what was left in it.
  carryReaches(store, [cut([1, 2, 3, 14])], 1, (_course, leftIn) => leftIn === 1);
  expect(store.reaches.get(1)!.former).toEqual([]);
  expect(store.reaches.has(2)).toBe(false);
});

it("drops a former course a river has taken back, and keeps each only once", () => {
  const store = emptyReaches();
  carryReaches(store, [cut([1, 2, 3, 4, 5, 6])], 0);
  carryReaches(store, [cut([1, 2, 3, 4, 15, 16])], 0);
  carryReaches(store, [cut([1, 2, 3, 4, 5, 6])], 0);
  expect(store.reaches.get(1)!.former).toEqual([{ cells: [15, 16], leftIn: 0 }]);
  carryReaches(store, [cut([1, 2, 3, 4, 15, 16])], 0);
  carryReaches(store, [cut([1, 2, 3, 4, 25, 26])], 0);
  expect(store.reaches.get(1)!.former.map(({ cells }) => cells)).toEqual([
    [5, 6],
    [15, 16],
  ]);
});

it("links each river to the one it runs into, by identity", () => {
  const store = emptyReaches();
  carryReaches(store, [cut([1, 2], { downstream: 1 }), cut([3, 4, 5], { order: 2 })], 0);
  expect(store.reaches.get(1)!.downstream).toBe(2);
  expect(store.reaches.get(2)!.downstream).toBeNull();
});

it("says which river a cell is on: a running one before a dry one", () => {
  const store = emptyReaches();
  carryReaches(store, [cut([1, 2, 3])], 0);
  carryReaches(store, [cut([3, 30, 31, 32])], 0);
  const at = reachOfCells(store);
  expect(at.get(2)!.dry).toBe(true);
  expect(at.get(3)!.dry).toBe(false);
  expect(at.get(99)).toBeUndefined();
});

it("counts a course as the same course while they share half of the longer", () => {
  expect(sameCourse(4, 6, 6)).toBe(true);
  expect(sameCourse(3, 6, 3)).toBe(true);
  expect(sameCourse(1, 6, 1)).toBe(false);
  expect(sameCourse(0, 6, 4)).toBe(false);
  expect(leftCourses([1, 2, 3, 4, 5], new Set([2, 4]))).toEqual([[1], [3], [5]]);
});
