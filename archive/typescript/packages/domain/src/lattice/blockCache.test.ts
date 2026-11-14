import { expect, it } from "vitest";
import { Band } from "./band";
import { BlockCache } from "./blockCache";

it("forgets released owners without requiring eviction pressure", () => {
  const cache = new BlockCache(Infinity);
  for (let i = 0; i < 1000; i++) {
    const band = new Band({ name: "temporary", type: "float64", lifetime: "process" }, 8, cache);
    band.fill(i);
    expect(cache.trackedBlocks).toBe(1);
    expect(cache.trackedOwners).toBe(1);
    band.release();
    expect(cache.bytes).toBe(0);
    expect(cache.trackedBlocks).toBe(0);
    expect(cache.trackedOwners).toBe(0);
  }
});

it("forgets one block without dropping its owner's remaining blocks", () => {
  const cache = new BlockCache(Infinity),
    owner = { evict() {} };
  cache.admit(owner, 0, 8);
  cache.admit(owner, 1, 16);
  cache.forget(owner, 0);
  expect(cache.bytes).toBe(16);
  expect(cache.trackedBlocks).toBe(1);
  expect(cache.trackedOwners).toBe(1);
  expect(() => cache.pin(owner, 0)).toThrow(/Pin a loaded block/);
  cache.pin(owner, 1);
  cache.unpin(owner, 1);
  cache.forget(owner);
  cache.forget(owner);
  expect(cache.bytes).toBe(0);
  expect(cache.trackedBlocks).toBe(0);
  expect(cache.trackedOwners).toBe(0);
});

it("gives recently used blocks a second chance and removes evicted owners", () => {
  const evicted: string[] = [],
    cache = new BlockCache(16),
    a = { evict: () => evicted.push("a") },
    b = { evict: () => evicted.push("b") },
    c = { evict: () => evicted.push("c") },
    d = { evict: () => evicted.push("d") };
  cache.admit(a, 0, 8);
  cache.admit(b, 0, 8);
  cache.touch(a, 0);
  cache.admit(c, 0, 8);
  expect(evicted).toEqual(["b"]);
  expect(cache.trackedOwners).toBe(2);
  cache.forget(c);
  cache.admit(d, 0, 16);
  expect(evicted).toEqual(["b", "a"]);
  expect(cache.bytes).toBe(16);
  expect(cache.trackedBlocks).toBe(1);
  expect(cache.trackedOwners).toBe(1);
});

it("keeps pinned and resident blocks while making progress after unpinning", () => {
  const evicted: number[] = [],
    cache = new BlockCache(8),
    owner = { evict: (block: number) => evicted.push(block) };
  cache.admit(owner, 0, 0);
  cache.admit(owner, 1, 8);
  cache.pin(owner, 1);
  cache.pin(owner, 1);
  cache.admit(owner, 2, 8);
  expect(evicted).toEqual([]);
  cache.unpin(owner, 1);
  cache.admit(owner, 3, 8);
  expect(evicted).toEqual([2]);
  cache.unpin(owner, 1);
  cache.forget(owner, 3);
  cache.admit(owner, 4, 8);
  expect(evicted).toEqual([2, 1]);
  expect(cache.trackedBlocks).toBe(2);
  expect(cache.bytes).toBe(8);
  cache.pin(owner, 0);
  cache.unpin(owner, 0);
  cache.forget(owner);
  expect(cache.trackedOwners).toBe(0);
  expect(cache.trackedBlocks).toBe(0);
});
