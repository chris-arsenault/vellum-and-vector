import { mkdtempSync, openSync, readSync, writeSync, fsyncSync, closeSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { NumericalVector, SampleType } from "@atlas/domain";
import { PagedArena } from "./pagedArena";

const opened: { arena: PagedArena; directory: string }[] = [];
afterEach(() => {
  for (const { arena, directory } of opened.splice(0)) {
    arena.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
function fixture(cacheBytes = 64, pageSamples = 4, transferBytes = Infinity) {
  const directory = mkdtempSync(join(tmpdir(), "atlas-numerical-")),
    fd = openSync(join(directory, "work.bin"), "w+");
  const arena = new PagedArena(
    {
      read: (bytes, offset) =>
        readSync(fd, bytes, 0, Math.min(bytes.byteLength, transferBytes), offset),
      write: (bytes, offset) =>
        writeSync(fd, bytes, 0, Math.min(bytes.byteLength, transferBytes), offset),
      flush: () => fsyncSync(fd),
      close: () => closeSync(fd),
    },
    cacheBytes,
    pageSamples
  );
  opened.push({ arena, directory });
  const vector = (
    length: number,
    type: SampleType = "float64",
    lifetime: "process" | "run" = "process"
  ) => arena.allocate({ length, type, lifetime, name: "case" });
  return { arena, vector };
}
describe("page-backed numerical views", () => {
  it("completes partial file transfers without dropping or duplicating samples", () => {
    const f = fixture(32, 4, 3),
      array = f.vector(40);
    for (let i = 0; i < array.length; i++) array[i] = i + 0.25;
    f.arena.flush();
    expect(Array.from(array)).toEqual(Array.from({ length: 40 }, (_, i) => i + 0.25));
  });
  it("retains indexed values through real file eviction with bounded decoded pages", () => {
    const f = fixture(),
      array = f.vector(100);
    for (let i = 0; i < array.length; i++) array[i] = i + 0.25;
    f.arena.flush();
    for (let i = array.length - 1; i >= 0; i--) expect(array[i]).toBe(i + 0.25);
    expect(f.arena.stats.reads).toBeGreaterThan(0);
    expect(f.arena.stats.peakDecodedBytes).toBeLessThanOrEqual(64);
  });
  it("matches native overlapping views, independent slices and chained mutation", () => {
    const f = fixture(),
      array = f.vector(12).fill(1),
      native = new Float64Array(12).fill(1);
    array.set([2, 3, 4, 5, 6]);
    native.set([2, 3, 4, 5, 6]);
    array.set(array.subarray(0, 8), 2);
    native.set(native.subarray(0, 8), 2);
    array.copyWithin(0, 3, 9).reverse();
    native.copyWithin(0, 3, 9).reverse();
    expect(Array.from(array)).toEqual(Array.from(native));
    const copy = array.slice(2, 7);
    copy[0] = 99;
    expect(array[2]).not.toBe(99);
    array.subarray(2, 7)[0] = 123;
    expect(array[2]).toBe(123);
    expect(() => f.arena.read(array.subarray(2, 3), 0, 2)).toThrow(/view/);
  });
  it("preserves dtypes, callback semantics and native typed array compatibility", () => {
    const f = fixture(),
      array = f.vector(5, "int8");
    array.set([130, -130, 3.8, 0, 5]);
    const native: NumericalVector = new Int8Array([130, -130, 3.8, 0, 5]);
    expect(Array.from(array)).toEqual(Array.from(native));
    expect(Array.from(array.map((v, i, a) => v + a.at(i)!))).toEqual(
      Array.from(native.map((v, i, a) => v + a.at(i)!))
    );
    expect(Array.from(array.filter((v, i) => v > 0 && i > 0))).toEqual(
      Array.from(native.filter((v, i) => v > 0 && i > 0))
    );
    expect(array.reduce((sum, v) => sum + v, 0)).toBe(native.reduce((sum, v) => sum + v, 0));
    expect(array.every((v) => Number.isFinite(v))).toBe(true);
    expect(array.some((v) => v < 0)).toBe(true);
    expect(array.at(-1)).toBe(native.at(-1));
  });
});
describe("numerical allocation lifetimes", () => {
  it("uses logical fills without writing every page and clears reused scratch allocations", () => {
    const f = fixture(),
      array = f.vector(100).fill(-1);
    expect(f.arena.stats.writtenBytes).toBe(0);
    array[50] = 12;
    f.arena.flush();
    expect(f.arena.stats.writtenBytes).toBe(32);
    array.fill(-0);
    expect(Object.is(array[50], -0)).toBe(true);
    f.arena.release(array);
    expect(() => array[0]).toThrow(/released/);
    expect(f.vector(100)[50]).toBe(0);
  });
  it("addresses sparse working data beyond four gigabytes without a dense allocation", () => {
    const f = fixture(),
      array = f.vector(600_000_000),
      next = f.vector(8);
    array[array.length - 1] = 42.5;
    next[7] = 84.25;
    f.arena.flush();
    expect(array[array.length - 1]).toBe(42.5);
    expect(next[7]).toBe(84.25);
    expect(f.arena.stats.writtenBytes).toBe(64);
    expect(f.arena.stats.peakDecodedBytes).toBeLessThanOrEqual(64);
  });
  it("releases process scratch while retained outputs remain readable", () => {
    const f = fixture(),
      scratch = f.vector(10),
      output = f.vector(10);
    output[3] = 7;
    f.arena.retain(output);
    f.arena.releaseProcess();
    expect(() => scratch[0]).toThrow(/released/);
    expect(output[3]).toBe(7);
  });
  it("releases nested reconciliation scratch without releasing its caller's working values", () => {
    const f = fixture(),
      outer = f.arena.beginProcess(),
      caller = f.vector(10);
    caller[1] = 5;
    const nested = f.arena.beginProcess(),
      child = f.vector(10),
      output = f.vector(10);
    output[2] = 7;
    output.retain?.();
    f.arena.releaseProcess(nested);
    expect(() => child[0]).toThrow(/released/);
    expect(caller[1]).toBe(5);
    expect(output[2]).toBe(7);
    f.arena.releaseProcess(outer);
    expect(() => caller[0]).toThrow(/released/);
    expect(output[2]).toBe(7);
  });
});
it("reclaims replaced owned buffers while preserving live subarray aliases", () => {
  const f = fixture(),
    replaced = f.vector(10),
    retained = f.vector(10),
    alias = retained.subarray(2, 5);
  retained[3] = 9;
  f.arena.retain(replaced);
  f.arena.retain(retained);
  f.arena.releaseUnused([replaced, retained, new Float64Array(2)], [alias]);
  expect(() => replaced[0]).toThrow(/released/);
  expect(alias[1]).toBe(9);
});
describe("external numerical sorting", () => {
  it("matches stable native sorting across multiple decoded runs", () => {
    const f = fixture(8192, 256),
      array = f.vector(40_000, "int32");
    const native = Int32Array.from({ length: array.length }, (_, i) => Math.imul(i, 7919) % 40_000);
    array.set(native);
    const compare = (a: number, b: number) => Math.floor(a / 11) - Math.floor(b / 11);
    array.sort(compare);
    native.sort(compare);
    expect(Array.from(array)).toEqual(Array.from(native));
  });
  it("retains floating-point sort order for NaN, infinities and signed zero", () => {
    const f = fixture(),
      array = f.vector(7),
      native = new Float64Array([NaN, 0, -0, Infinity, 4, -Infinity, NaN]);
    array.set(native);
    array.sort();
    native.sort();
    expect(Array.from(array)).toEqual(Array.from(native));
  });
});
