import { expect, it } from "vitest";
import { sampleCoverage, readRange } from "./bandValues";
import { ReadBandView } from "./readBand";

it("retains live reads while every exposed bulk value is independent", () => {
  const coverage = sampleCoverage(3),
    owner = coverage.allocate({ name: "ground", type: "float64", lifetime: "run" }),
    view = new ReadBandView(owner);
  owner.set(1, 7);
  const block = view.block(0),
    array = view.toArray(),
    snapshot = coverage.copyBand(view),
    copy = coverage.scratch("float64", "copy");
  copy.copyFrom(view);
  block[1] = 90;
  array[1] = 91;
  snapshot.set(1, 92);
  copy.set(1, 93);
  expect(view.get(1)).toBe(7);
  owner.set(1, 8);
  expect(view.get(1)).toBe(8);
  expect(readRange(view, 1, 1)[0]).toBe(8);
  expect("set" in view).toBe(false);
  expect("copyFrom" in view).toBe(false);
  expect(Object.isFrozen(view)).toBe(true);
  expect(Object.isFrozen(view.schema)).toBe(true);
});

it("uses read views for block algorithms without leaking writable originals", () => {
  const coverage = sampleCoverage(3),
    owner = coverage.allocate({ name: "ground", type: "float64", lifetime: "run" }),
    view = new ReadBandView(owner);
  owner.set(0, 3);
  owner.set(1, 1);
  owner.set(2, 2);
  coverage.forEachBlock([view], ([block]) => block.fill(100));
  expect([...coverage.order(view)]).toEqual([1, 2, 0]);
  expect(coverage.reduce(view, (sum, value) => sum + value, 0)).toBe(6);
});
