import { expect, it } from "vitest";
import { Band } from "./band";
import { BlockCache } from "./blockCache";
import { BlockScratch, type RandomAccessFile } from "./blockScratch";
import { Coverage } from "./coverage";
import { blockCells, forEachCell } from "./lattice";
import { createWorldLattice } from "./worldLattice";

/** A scratch file in memory, for tests. */
export function memoryFile(): RandomAccessFile & { bytes(): number } {
  let store = new Uint8Array(1 << 16);
  const ensure = (end: number) => {
    if (end <= store.length) return;
    const next = new Uint8Array(Math.max(end, store.length * 2));
    next.set(store);
    store = next;
  };
  return {
    read: (bytes, offset) => {
      bytes.set(store.subarray(offset, offset + bytes.length));
      return bytes.length;
    },
    write: (bytes, offset) => {
      ensure(offset + bytes.length);
      store.set(bytes, offset);
      return bytes.length;
    },
    flush: () => {},
    close: () => {},
    bytes: () => store.length,
  };
}
const schema = { name: "values", type: "float64", lifetime: "run" } as const;

it("reads and writes a resident band through blocks and samples", () => {
  const cache = new BlockCache(Infinity),
    band = new Band({ ...schema, initial: 7 }, blockCells * 2 + 5, cache);
  expect(band.blockCount).toBe(3);
  expect(band.get(0)).toBe(7);
  expect(band.get(band.length - 1)).toBe(7);
  band.set(blockCells + 3, 42);
  band.add(blockCells + 3, 1);
  expect(band.get(blockCells + 3)).toBe(43);
  const values = band.block(2, true);
  values[4] = 9;
  band.unpin(2);
  expect(band.get(blockCells * 2 + 4)).toBe(9);
  band.fill(1, 10, blockCells + 10);
  expect(band.get(9)).toBe(7);
  expect(band.get(10)).toBe(1);
  expect(band.get(blockCells + 9)).toBe(1);
  expect(band.get(blockCells + 10)).toBe(7);
  expect(Array.from(band.toArray()).length).toBe(band.length);
});
it("spills dirty blocks under a small budget and reads them back exactly", () => {
  const file = memoryFile(),
    cache = new BlockCache(blockCells * 8 * 3, new BlockScratch(file)),
    band = new Band(schema, blockCells * 10, cache);
  for (let i = 0; i < band.length; i += 97) band.set(i, i * 0.5);
  expect(cache.stats.evictions).toBeGreaterThan(0);
  expect(cache.bytes).toBeLessThanOrEqual(cache.budgetBytes);
  for (let i = 0; i < band.length; i += 97) expect(band.get(i)).toBe(i * 0.5);
  expect(band.get(50)).toBe(0);
  expect(cache.scratch!.stats.writes).toBeGreaterThan(0);
  expect(cache.scratch!.stats.reads).toBeGreaterThan(0);
  // A pinned block survives any pressure.
  const pinned = band.block(0, true);
  for (let i = blockCells; i < band.length; i += 13) band.set(i, 1);
  pinned[1] = 5;
  band.unpin(0);
  expect(band.get(1)).toBe(5);
});
it("loads from a committed source and keeps writes over it", () => {
  const cache = new BlockCache(Infinity),
    band = new Band(schema, blockCells + 1, cache, (block, into) => into.fill(block + 100));
  expect(band.get(0)).toBe(100);
  expect(band.get(blockCells)).toBe(101);
  band.set(0, 3);
  expect(band.get(0)).toBe(3);
  expect(band.get(1)).toBe(100);
});
it("snapshots copy-on-write across memory and spilled blocks", () => {
  const file = memoryFile(),
    cache = new BlockCache(blockCells * 8 * 2, new BlockScratch(file)),
    band = new Band(schema, blockCells * 4, cache);
  for (let b = 0; b < 4; b++) band.set(b * blockCells + 1, b + 1);
  const copy = band.snapshot();
  for (let b = 0; b < 4; b++) expect(copy.get(b * blockCells + 1)).toBe(b + 1);
  band.set(1, 50);
  band.set(3 * blockCells + 1, 60);
  copy.set(2 * blockCells + 1, 70);
  // Force everything through the scratch and back.
  for (let b = 0; b < 4; b++) {
    band.set(b * blockCells + 2, 1);
    copy.set(b * blockCells + 2, 2);
  }
  expect(band.get(1)).toBe(50);
  expect(copy.get(1)).toBe(1);
  expect(band.get(3 * blockCells + 1)).toBe(60);
  expect(copy.get(3 * blockCells + 1)).toBe(4);
  expect(band.get(2 * blockCells + 1)).toBe(3);
  expect(copy.get(2 * blockCells + 1)).toBe(70);
  band.release();
  expect(copy.get(1)).toBe(1);
  expect(() => band.get(0)).toThrow(/released/);
});
it("iterates a coverage by block, orders and reduces as streams, and releases scratch", () => {
  const lattice = createWorldLattice([-50_000, -25_000, 50_000, 25_000], 20_000, 2_000),
    coverage = new Coverage(lattice);
  expect(lattice.blockCount).toBeGreaterThan(1);
  const elevation = coverage.allocate({ name: "elevation", type: "float64", lifetime: "run" });
  coverage.forEachBlock(
    [elevation],
    ([values], start, count) => {
      for (let n = 0; n < count; n++) values[n] = Math.sin(start + n) * 1000;
    },
    [elevation]
  );
  let live = 0;
  forEachCell(lattice, () => live++);
  const total = coverage.reduce(elevation, (sum, value) => sum + value, 0);
  let expected = 0;
  forEachCell(lattice, (cell) => (expected += Math.sin(cell) * 1000));
  expect(total).toBeCloseTo(expected, 6);
  const descending = [...coverage.order(elevation, true)],
    ascending = [...coverage.order(elevation)];
  expect(descending.length).toBe(live);
  expect(ascending.length).toBe(live);
  for (let n = 1; n < descending.length; n++) {
    const a = elevation.get(descending[n - 1]),
      b = elevation.get(descending[n]);
    expect(a >= b).toBe(true);
    if (a === b) expect(descending[n - 1] < descending[n]).toBe(true);
    expect(elevation.get(ascending[n - 1]) <= elevation.get(ascending[n])).toBe(true);
  }
  const start = coverage.beginProcess(),
    work = coverage.scratch("int32", "work");
  work.set(5, 1);
  coverage.releaseProcess(start);
  expect(work.released).toBe(true);
  expect(elevation.released).toBe(false);
  const copy = coverage.snapshot();
  expect(copy.band("elevation").get(descending[0])).toBe(elevation.get(descending[0]));
});
