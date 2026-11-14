import { mkdirSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { Band } from "./band";
import { BlockCache } from "./blockCache";
import { BlockScratch, type RandomAccessFile } from "./blockScratch";
import { blockCells } from "./lattice";

/** One run: block reads resident and forced-evicting against a native array. No assertions
 * on timing; numbers go to test-results. Sizes are tile sized, never a full large world. */
function memoryFile(): RandomAccessFile {
  let store = new Uint8Array(1 << 20);
  return {
    read: (bytes, offset) => {
      bytes.set(store.subarray(offset, offset + bytes.length));
      return bytes.length;
    },
    write: (bytes, offset) => {
      if (offset + bytes.length > store.length) {
        const next = new Uint8Array(Math.max(offset + bytes.length, store.length * 2));
        next.set(store);
        store = next;
      }
      store.set(bytes, offset);
      return bytes.length;
    },
    flush: () => {},
    close: () => {},
  };
}
const ms = (t: number) => Math.round((performance.now() - t) * 10) / 10;
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
function sequentialNative(values: Float64Array) {
  let t = performance.now(),
    sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  const read = ms(t);
  t = performance.now();
  for (let i = 0; i < values.length; i++) values[i] = i * 0.5;
  return { read, write: ms(t), sink: sum };
}
function sequentialBand(band: Band) {
  let t = performance.now(),
    sum = 0;
  for (let i = 0; i < band.length; i++) sum += band.get(i);
  const read = ms(t);
  t = performance.now();
  for (let i = 0; i < band.length; i++) band.set(i, i * 0.5);
  const write = ms(t);
  t = performance.now();
  let blockSum = 0;
  for (let b = 0; b < band.blockCount; b++) {
    const values = band.block(b);
    for (let n = 0; n < values.length; n++) blockSum += values[n];
    band.unpin(b);
  }
  return { read, write, blockRead: ms(t), sink: sum + blockSum };
}
function randomNative(values: Float64Array, n: number) {
  const next = random(3),
    t = performance.now();
  let sum = 0;
  for (let k = 0; k < n; k++) sum += values[Math.floor(next() * values.length)];
  return { random: ms(t), sink: sum };
}
function randomBand(band: Band, n: number) {
  const next = random(3),
    t = performance.now();
  let sum = 0;
  for (let k = 0; k < n; k++) sum += band.get(Math.floor(next() * band.length));
  return { random: ms(t), sink: sum };
}
/** A flood-shaped walk: mostly local steps with occasional jumps, the connected-pass shape. */
function walkBand(band: Band, n: number) {
  const next = random(5),
    t = performance.now();
  let sum = 0,
    at = 0;
  for (let k = 0; k < n; k++) {
    at =
      next() < 0.98
        ? (at + Math.floor(next() * 7) - 3 + band.length) % band.length
        : Math.floor(next() * band.length);
    sum += band.get(at);
  }
  return { walk: ms(t), sink: sum };
}
it("records one run of block reads resident and forced-evicting against native arrays", () => {
  const sizes = [blockCells, 1_000_000],
    results: Record<string, unknown> = {};
  // One unmeasured pass so the first measured size does not pay JIT warm-up.
  {
    const warm = new Band(
      { name: "w", type: "float64", lifetime: "run" },
      blockCells * 4,
      new BlockCache(Infinity)
    );
    for (let round = 0; round < 3; round++) {
      sequentialBand(warm);
      randomBand(warm, warm.length);
      walkBand(warm, warm.length);
    }
  }
  for (const length of sizes) {
    const native = new Float64Array(length);
    for (let i = 0; i < length; i++) native[i] = i;
    const resident = new Band(
      { name: "r", type: "float64", lifetime: "run" },
      length,
      new BlockCache(Infinity)
    );
    for (let i = 0; i < length; i++) resident.set(i, i);
    const scratch = new BlockScratch(memoryFile()),
      evicting = new Band(
        { name: "e", type: "float64", lifetime: "run" },
        length,
        new BlockCache(Math.max(1, Math.floor(length / blockCells / 4)) * blockCells * 8, scratch)
      );
    for (let i = 0; i < length; i++) evicting.set(i, i);
    results[length] = {
      native: { ...sequentialNative(native), ...randomNative(native, length) },
      resident: {
        ...sequentialBand(resident),
        ...randomBand(resident, length),
        ...walkBand(resident, length),
      },
      evicting: {
        ...sequentialBand(evicting),
        // Uniform random access over a cache a quarter of the band is the pathological
        // shape; a tenth of the accesses is enough to record its cost.
        ...randomBand(evicting, Math.ceil(length / 10)),
        ...walkBand(evicting, length),
        scratchReads: scratch.stats.reads,
        scratchWrites: scratch.stats.writes,
      },
    };
  }
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/coverage.json", JSON.stringify(results, null, 1));
});
