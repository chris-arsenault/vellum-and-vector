import { expect, it } from "vitest";
import {
  adaptiveCell,
  adaptiveGeometry,
  adaptiveLeafAt,
  createAdaptiveTopology,
} from "./adaptiveTopology";
import { reconstructAdaptive, sampleAdaptive } from "./adaptiveReconstruction";
import { transferAdaptive, visitAdaptiveOverlap } from "./adaptiveTransfer";
import { createAdaptiveField, adaptiveFieldSampler, adaptiveIntegral } from "./adaptiveField";
import { rectangle } from "./spatial";
import { sampleAdaptivePoint, adaptivePointLocator } from "./adaptivePoint";
import { gridSampler, fieldInterpolator } from "./grids";
import { adaptiveExtrema } from "./adaptiveExtrema";
import { adaptiveFits } from "./adaptiveFit";

const topology = () =>
  createAdaptiveTopology([0, 0, 1000, 1000], {
    maximumSize: 250,
    minimumSize: 15.625,
    refine: (box) => box[0] < 500 && box[2] > 450 && box[1] < 600 && box[3] > 400,
  });
it("partitions physical area and shares reciprocal face lengths across different cell sizes", () => {
  const tree = topology(),
    geometry = adaptiveGeometry(tree);
  expect(geometry.areas.reduce((a, b) => a + b, 0)).toBe(1_000_000);
  expect(new Set(geometry.areas).size).toBeGreaterThan(1);
  expect(
    Math.max(...Array.from(tree.leaves, (_, i) => tree.offsets[i + 1] - tree.offsets[i]))
  ).toBeGreaterThan(4);
  for (let i = 0; i < tree.leaves.length; i++) {
    expect(adaptiveLeafAt(tree, geometry.x[i], geometry.y[i])).toBe(i);
    for (let at = tree.offsets[i]; at < tree.offsets[i + 1]; at++) {
      const j = tree.neighbors[at];
      const reverse =
        Array.from(tree.neighbors.subarray(tree.offsets[j], tree.offsets[j + 1])).indexOf(i) +
        tree.offsets[j];
      expect(tree.neighbors[reverse]).toBe(i);
      expect(tree.faceLengths[reverse]).toBe(tree.faceLengths[at]);
      expect(tree.normalX[reverse] + tree.normalX[at]).toBe(0);
      expect(tree.normalY[reverse] + tree.normalY[at]).toBe(0);
      expect(
        Math.abs(tree.levels[tree.leaves[i]] - tree.levels[tree.leaves[j]])
      ).toBeLessThanOrEqual(1);
    }
  }
});

it("visits precisely the overlapping cells across split faces and outside the field", () => {
  const tree = topology();
  for (const box of [
    [0, 0, 250, 250],
    [450, 400, 505, 600],
    [-10, -10, 0, 0],
    [990, 990, 1010, 1010],
  ]) {
    const visited: number[] = [];
    visitAdaptiveOverlap(tree, box as [number, number, number, number], (leaf) =>
      visited.push(leaf)
    );
    const expected = Array.from(tree.leaves.keys()).filter((leaf) => {
      const cell = adaptiveCell(tree, leaf);
      return (
        Math.min(cell[2], box[2]) > Math.max(cell[0], box[0]) &&
        Math.min(cell[3], box[3]) > Math.max(cell[1], box[1])
      );
    });
    expect(visited.sort((a, b) => a - b)).toEqual(expected);
  }
});
it("reconstructs rotated planes and stays continuous at coarse/fine interfaces", () => {
  const tree = topology(),
    geometry = adaptiveGeometry(tree);
  const values = Float64Array.from(geometry.x, (x, i) => 3 + x * 0.3 - geometry.y[i] * 0.7);
  const surface = reconstructAdaptive(tree, values);
  for (let y = 1; y < 1000; y += 37)
    for (let x = 1; x < 1000; x += 41)
      expect(sampleAdaptive(surface, x, y)).toBeCloseTo(3 + x * 0.3 - y * 0.7, 8);
  const relief = reconstructAdaptive(
    tree,
    Float64Array.from(values, (_, i) => Math.sin(geometry.x[i] / 80) * 200 + geometry.y[i])
  );
  for (let y = 401; y < 600; y += 11)
    expect(
      Math.abs(sampleAdaptive(relief, 500 - 1e-7, y) - sampleAdaptive(relief, 500 + 1e-7, y))
    ).toBeLessThan(1e-4);
  for (let y = 3; y < 1000; y += 31)
    for (let x = 7; x < 1000; x += 29)
      expect(sampleAdaptivePoint(tree, relief.values, x, y)).toBeCloseTo(
        sampleAdaptive(relief, x, y),
        8
      );
});
it("preserves intensive integrals and extensive totals through refinement and coarsening", () => {
  const coarse = createAdaptiveTopology([0, 0, 1000, 1000], { maximumSize: 250, minimumSize: 250 });
  const fine = topology(),
    cg = adaptiveGeometry(coarse),
    fg = adaptiveGeometry(fine);
  const values = Float64Array.from(cg.x, (x, i) => 4 + x / 200 + cg.y[i] / 1000);
  const refined = transferAdaptive(coarse, fine, values, "intensive");
  const integral = (v: Float64Array, area: Float64Array) =>
    v.reduce((sum, value, i) => sum + value * area[i], 0);
  expect(integral(refined, fg.areas)).toBeCloseTo(integral(values, cg.areas), 6);
  expect(Array.from(transferAdaptive(fine, coarse, refined, "intensive"))).toEqual(
    Array.from(values)
  );
  const extensive = Float64Array.from(values, (v, i) => v * cg.areas[i]);
  expect(
    transferAdaptive(coarse, fine, extensive, "extensive").reduce((a, b) => a + b, 0)
  ).toBeCloseTo(
    extensive.reduce((a, b) => a + b, 0),
    6
  );
  const classes = Float64Array.from(cg.x, (x) => (x < 500 ? 11 : 29));
  expect(new Set(transferAdaptive(coarse, fine, classes, "category"))).toEqual(new Set([11, 29]));
});
it("resolves a narrow physical feature where its support requests detail", () => {
  const tree = topology(),
    geometry = adaptiveGeometry(tree);
  const values = Float64Array.from(geometry.x, (x) => -100 * Math.exp(-(((x - 475) / 18) ** 2)));
  const field = reconstructAdaptive(tree, values);
  expect(sampleAdaptive(field, 475, 500)).toBeLessThan(-80);
  expect(Math.abs(sampleAdaptive(field, 550, 500))).toBeLessThan(3);
  expect(
    adaptiveCell(tree, adaptiveLeafAt(tree, 475, 500))[2] -
      adaptiveCell(tree, adaptiveLeafAt(tree, 475, 500))[0]
  ).toBeLessThan(20);
});

it("retains measured heights and continuous slopes across coarse/fine faces", () => {
  const tree = topology(),
    geometry = adaptiveGeometry(tree);
  const values = Float64Array.from(
    geometry.x,
    (x, i) => 100 * Math.sin(x / 150) * Math.cos(geometry.y[i] / 190)
  );
  const surface = reconstructAdaptive(tree, values);
  for (let i = 0; i < values.length; i++)
    expect(sampleAdaptive(surface, geometry.x[i], geometry.y[i])).toBeCloseTo(values[i], 9);
  const epsilon = 1e-4;
  for (let i = 0; i < values.length; i++) {
    const box = adaptiveCell(tree, i);
    for (let edge = tree.offsets[i]; edge < tree.offsets[i + 1]; edge++) {
      const j = tree.neighbors[edge];
      if (i > j) continue;
      const other = adaptiveCell(tree, j),
        nx = tree.normalX[edge],
        ny = tree.normalY[edge];
      const x = nx
        ? nx > 0
          ? box[2]
          : box[0]
        : (Math.max(box[0], other[0]) + Math.min(box[2], other[2])) / 2;
      const y = ny
        ? ny > 0
          ? box[3]
          : box[1]
        : (Math.max(box[1], other[1]) + Math.min(box[3], other[3])) / 2;
      const at = (offset: number) => sampleAdaptive(surface, x + nx * offset, y + ny * offset);
      const left = (at(-epsilon) - at(-2 * epsilon)) / epsilon;
      const right = (at(2 * epsilon) - at(epsilon)) / epsilon;
      expect(Math.abs(left - right), `slope at ${x},${y}`).toBeLessThan(0.001);
    }
  }
});

it("reproduces smooth curvature without manufacturing one hump per sampling cell", () => {
  const tree = topology(),
    geometry = adaptiveGeometry(tree);
  const height = (x: number, y: number) =>
    20 + x * 0.1 + y * 0.2 + x * x * 0.0004 + x * y * 0.0002 + y * y * 0.0003;
  const at = reconstructAdaptive(
    tree,
    Float64Array.from(geometry.x, (x, i) => height(x, geometry.y[i]))
  );
  for (let y = 21; y < 1000; y += 59)
    for (let x = 17; x < 1000; x += 53)
      expect(sampleAdaptive(at, x, y)).toBeCloseTo(height(x, y), 6);
});

it("does not invent interior peaks or negative values between nonnegative samples", () => {
  const tree = topology(),
    geometry = adaptiveGeometry(tree);
  const values = Float64Array.from(geometry.x, (x, i) =>
    Math.max(0, 100 - Math.hypot(x - 500, geometry.y[i] - 500))
  );
  const field = reconstructAdaptive(tree, values),
    maximum = Math.max(...values);
  for (let y = 10; y < 1000; y += 13)
    for (let x = 10; x < 1000; x += 17) {
      const value = sampleAdaptive(field, x, y);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(maximum);
      expect(sampleAdaptivePoint(tree, values, x, y)).toBeCloseTo(value, 8);
    }
});

it("retains clipped physical measures and discrete category meaning in published fields", () => {
  const tree = topology();
  const field = createAdaptiveField(
    "field",
    {
      worldId: "world",
      areaId: "area",
      spaceId: "surface",
      crsId: "metres",
      footprint: rectangle([140, 140, 860, 860]),
      time: "present",
      revision: 1,
      resolution: null,
    },
    tree
  );
  field.channels.elevation = new Float64Array(tree.leaves.length).fill(12);
  field.channels.material = Float64Array.from(adaptiveGeometry(tree).x, (x) => (x < 500 ? 11 : 29));
  field.units.elevation = "metre";
  field.units.material = "category";
  expect(adaptiveIntegral(field, "elevation")).toBeCloseTo(720 * 720 * 12, 6);
  expect(adaptiveFieldSampler(field, "elevation")({ x: 145, y: 145 })).toBeCloseTo(12, 10);
  expect(adaptiveFieldSampler(field, "material")({ x: 499.999, y: 500 })).toBe(11);
  expect(adaptiveFieldSampler(field, "material")({ x: 500.001, y: 500 })).toBe(29);
  expect(adaptiveFieldSampler(field, "elevation")({ x: 100, y: 100 })).toBeNaN();
  field.units.material = "metre";
  field.quantities = { material: "category" };
  expect(gridSampler(field, "material")({ x: 499.999, y: 500, z: 0 })).toBe(11);
  expect(adaptiveFieldSampler(field, "material")({ x: 500.001, y: 500 })).toBe(29);
  expect(adaptiveExtrema(field, "material", rectangle([495, 495, 505, 505]))).toEqual([11, 29]);
});

it("shares fitting geometry while retaining each channel's signed quadratic derivatives", () => {
  const tree = topology(),
    geometry = adaptiveGeometry(tree);
  for (const sign of [1, -3, 0]) {
    const fit = adaptiveFits(
      tree,
      Float64Array.from(geometry.x, (x, i) => {
        const y = geometry.y[i];
        return sign * (20 + x * 0.1 + y * 0.2 + x * x * 0.0004 + x * y * 0.0002 + y * y * 0.0003);
      })
    );
    for (let i = 0; i < geometry.x.length; i++) {
      const expected = [
        sign * (0.1 + 0.0008 * geometry.x[i] + 0.0002 * geometry.y[i]),
        sign * (0.2 + 0.0002 * geometry.x[i] + 0.0006 * geometry.y[i]),
        sign * 0.0004,
        sign * 0.0002,
        sign * 0.0003,
      ];
      fit(i).forEach((value, k) => expect(value).toBeCloseTo(expected[k], 9));
    }
  }
});

it("retains planar and constant fallbacks when a curvature stencil is singular", () => {
  for (const size of [1000, 500]) {
    const tree = createAdaptiveTopology([0, 0, 1000, 1000], {
        maximumSize: size,
        minimumSize: size,
      }),
      geometry = adaptiveGeometry(tree);
    const fit = adaptiveFits(
      tree,
      Float64Array.from(geometry.x, (x, i) => 2 + 0.3 * x - 0.7 * geometry.y[i])
    );
    for (let i = 0; i < geometry.x.length; i++)
      fit(i).forEach((value, k) =>
        expect(value).toBeCloseTo(size === 1000 ? 0 : [0.3, -0.7, 0, 0, 0][k], 9)
      );
  }
});

it("shares point lookup without mixing channels, topology identities or discrete samples", () => {
  const tree = topology(),
    geometry = adaptiveGeometry(tree),
    locate = adaptivePointLocator();
  const field = createAdaptiveField(
    "shared",
    {
      worldId: "world",
      areaId: "area",
      spaceId: "surface",
      crsId: "metres",
      footprint: rectangle([0, 0, 1000, 1000]),
      time: "present",
      revision: 1,
      resolution: null,
    },
    tree
  );
  field.channels.elevation = Float64Array.from(geometry.x, (x, i) => x * 0.3 - geometry.y[i] * 0.7);
  field.channels.temperature = Float64Array.from(field.channels.elevation, (v) => -v * 2);
  field.channels.rock = Float64Array.from(geometry.x, (x) => (x < 500 ? 11 : 29));
  field.units = { elevation: "metre", temperature: "celsius", rock: "category" };
  const at = ["elevation", "temperature", "rock"].map((key) =>
    fieldInterpolator(field, key, false, locate)
  );
  const other = createAdaptiveTopology([0, 0, 1000, 1000], { maximumSize: 500, minimumSize: 500 });
  for (const x of [0, 499.999, 500, 500.001, 1000, 500, 0]) {
    const p = { x, y: 500, z: 0 };
    expect(at[0](p)).toBeCloseTo(x * 0.3 - 350, 8);
    expect(locate(other, x, 500).leaf).toBe(adaptiveLeafAt(other, x, 500));
    expect(at[1](p)).toBeCloseTo(-2 * (x * 0.3 - 350), 8);
    expect(at[2](p)).toBe(x < 500 ? 11 : 29);
  }
  expect(locate(tree, -1, 500).leaf).toBe(-1);
});
