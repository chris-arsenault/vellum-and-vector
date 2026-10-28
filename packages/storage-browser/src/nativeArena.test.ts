import { afterEach, expect, it } from "vitest";
import { arenaFixture } from "./numericalFixture";

const opened: ReturnType<typeof arenaFixture>[] = [];
afterEach(() => {
  for (const fixture of opened.splice(0)) fixture.close();
});
function arena(residentBytes: number) {
  const fixture = arenaFixture(1024, 4, residentBytes);
  opened.push(fixture);
  return fixture.arena;
}

it("hands out native typed arrays inside the resident budget and pages beyond it", () => {
  const a = arena(64);
  const native = a.allocate({ type: "float64", length: 4, lifetime: "process", name: "a" });
  expect(native).toBeInstanceOf(Float64Array);
  expect(a.isNative(native)).toBe(true);
  const paged = a.allocate({ type: "float64", length: 8, lifetime: "process", name: "b" });
  expect(ArrayBuffer.isView(paged)).toBe(false);
  paged[3] = 7;
  expect(paged[3]).toBe(7);
  expect(a.stats.peakResidentBytes).toBe(32);
});

it("releases process-lifetime natives at process end unless retained", () => {
  const a = arena(1024);
  const start = a.beginProcess();
  const dropped = a.allocate({ type: "int32", length: 2, lifetime: "process", name: "d" });
  const kept = a.allocate({ type: "int32", length: 2, lifetime: "process", name: "k" });
  kept.retain!();
  a.releaseProcess(start);
  expect(a.isNative(dropped)).toBe(true);
  // Released natives no longer count against the budget; the retained one still does.
  expect(a.stats.peakResidentBytes).toBe(16);
  const next = a.allocate({ type: "int32", length: 2, lifetime: "process", name: "n" });
  expect(next).toBeInstanceOf(Int32Array);
  a.releaseUnused([kept], []);
  a.release(next);
});

it("block reads and writes through the allocator work on native vectors", () => {
  const a = arena(1024);
  const v = a.allocate({ type: "float32", length: 6, lifetime: "run", name: "v" });
  a.write(v, 2, new Float32Array([1, 2, 3]));
  expect(Array.from(a.read(v, 1, 4))).toEqual([0, 1, 2, 3]);
  a.retain(new Float32Array(3));
});
