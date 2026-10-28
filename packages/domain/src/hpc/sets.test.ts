import { expect, it } from "vitest";
import { BitSet, popcount } from "./bitSet";
import { EpochStamps } from "./epochStamps";
import { UnionFind } from "./unionFind";
import { groupByLabel } from "./groupByLabel";
import { SmallIntSet } from "./smallIntSet";

it("BitSet tracks bits, counts them and walks set indices", () => {
  const bits = new BitSet(1000),
    reference = new Set<number>();
  for (let i = 0; i < 1000; i += 7) {
    bits.set(i);
    reference.add(i);
  }
  for (let i = 0; i < 1000; i += 21) {
    bits.clear(i);
    reference.delete(i);
  }
  expect(bits.count()).toBe(reference.size);
  for (let i = 0; i < 1000; i++) expect(bits.has(i)).toBe(reference.has(i));
  const walked: number[] = [];
  bits.forEach((i) => walked.push(i));
  expect(walked).toEqual([...reference].sort((a, b) => a - b));
  expect(bits.add(998)).toBe(true);
  expect(bits.add(998)).toBe(false);
  expect(bits.nextSet(999)).toBe(-1);
  expect(popcount(0xffffffff)).toBe(32);
  expect(popcount(0x80000001)).toBe(2);
  bits.clearAll();
  expect(bits.count()).toBe(0);
});

it("EpochStamps resets in O(1) and reads paired values with a fallback", () => {
  const stamps = new EpochStamps(10, true);
  stamps.begin();
  expect(stamps.mark(3)).toBe(true);
  expect(stamps.mark(3)).toBe(false);
  stamps.set(4, 2.5);
  expect(stamps.get(4, -1)).toBe(2.5);
  expect(stamps.get(5, -1)).toBe(-1);
  stamps.begin();
  expect(stamps.marked(3)).toBe(false);
  expect(stamps.get(4, -1)).toBe(-1);
});

it("UnionFind matches a reference labelling", () => {
  const n = 500,
    sets = new UnionFind(n),
    reference = Int32Array.from({ length: n }, (_, i) => i);
  for (let i = 0; i < n; i++) sets.make(i);
  let state = 9;
  for (let k = 0; k < 400; k++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const a = state % n,
      b = (state >>> 8) % n;
    sets.union(a, b);
    const ra = reference[a],
      rb = reference[b];
    for (let i = 0; i < n; i++) if (reference[i] === rb) reference[i] = ra;
  }
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < i + 5 && j < n; j++)
      expect(sets.find(i) === sets.find(j)).toBe(reference[i] === reference[j]);
  expect(sets.attach(0, 1)).toBe(sets.find(0));
  expect(sets.active(0)).toBe(true);
  expect(new UnionFind(2).active(0)).toBe(false);
});

it("groupByLabel builds CSR members per label in index order", () => {
  const labels = Int32Array.from([2, -1, 0, 2, 1, 0, -1, 2]);
  const groups = groupByLabel(labels, 3);
  expect(Array.from(groups.offsets)).toEqual([0, 2, 3, 6]);
  expect(Array.from(groups.members)).toEqual([2, 5, 4, 0, 3, 7]);
  expect(Array.from(groups.members_of(2))).toEqual([0, 3, 7]);
  expect(Array.from(groups.members_of(1))).toEqual([4]);
});

it("SmallIntSet deduplicates and grows", () => {
  const set = new SmallIntSet(2);
  for (const v of [5, 3, 5, 9, 3, 1, 7]) set.add(v);
  expect(set.size).toBe(5);
  expect(set.has(9)).toBe(true);
  expect(set.has(4)).toBe(false);
  expect(Array.from(set.items()).sort()).toEqual([1, 3, 5, 7, 9]);
  set.clear();
  expect(set.size).toBe(0);
});
