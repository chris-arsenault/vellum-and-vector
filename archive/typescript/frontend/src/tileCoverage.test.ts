import { expect, it } from "vitest";
import { rectangle } from "@atlas/domain";
import { insideAt, sampledExtent, tileCoverage } from "./tileCoverage";

it("resolves whole tiles once and tests edge tiles per point", () => {
  const coverage = tileCoverage(rectangle([0, 0, 100, 100]));
  expect(coverage([10, 10, 20, 20])).toBe(true);
  expect(coverage([200, 200, 300, 300])).toBe(false);
  const edge = coverage([90, 90, 110, 110]);
  expect(typeof edge).toBe("function");
  expect(insideAt(edge, { x: 95, y: 95, z: 0 })).toBe(true);
  expect(insideAt(edge, { x: 105, y: 95, z: 0 })).toBe(false);
});
it("widens a tile across the chart seam to the chart's width", () => {
  expect(sampledExtent([10, 0, 20, 10], [0, 100])).toEqual([10, 0, 20, 10]);
  expect(sampledExtent([90, 0, 110, 10], [0, 100])).toEqual([0, 0, 100, 10]);
  expect(sampledExtent([90, 0, 110, 10])).toEqual([90, 0, 110, 10]);
});
