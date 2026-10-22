import { expect, it } from "vitest";
import { samplePositiveSupport } from "./samplePositiveSupport";
import { preparedSampleInterpolator, type SampleSupport } from "./smoothSamples";
import { createAdaptiveTopology } from "./adaptiveTopology";
import { fieldContour } from "./fieldContours";
import { spatial } from "./spatial";

it("encloses negative values beyond the positive support disk on sparse samples", () => {
  const support = {
    x: Float64Array.of(0, 10, 0, 10),
    y: Float64Array.of(0, 0, 10, 10),
    origin: [0, 0] as [number, number],
    spacing: 1,
  };
  const coefficients = { dx: new Float64Array(4), dy: new Float64Array(4), affine: false };
  const read = samplePositiveSupport(support, Float64Array.of(1, 0, 0, 0), coefficients)!;
  const range = read.enclose([3, 0, 3.5, 0]).range;
  for (const x of [3, 3.1, 3.25, 3.5]) {
    expect(read(x, 0)).toBeGreaterThanOrEqual(range[0]);
    expect(read(x, 0)).toBeLessThanOrEqual(range[1]);
  }
});

it("traces the positive quantitative basis support, including arbitrarily small histories", () => {
  const nodes: [number, number][] = [];
  for (let y = -300; y <= 300; y += 100)
    for (let x = -300; x <= 300; x += 100)
      if (Math.abs(x) !== 300 || Math.abs(y) !== 300) nodes.push([x, y]);
  const support: SampleSupport = {
    x: Float64Array.from(nodes, (p) => p[0]),
    y: Float64Array.from(nodes, (p) => p[1]),
    origin: [0, 0],
    spacing: 100,
  };
  const values = Float64Array.from(nodes, ([x, y]) => (x === 0 && y === 0 ? 1e-20 : 0));
  const coefficients = {
    dx: new Float64Array(nodes.length),
    dy: new Float64Array(nodes.length),
    affine: false,
  };
  const read = preparedSampleInterpolator(support, values, coefficients),
    positive = samplePositiveSupport(support, values, coefficients)!;
  for (let y = -299; y < 300; y += 17)
    for (let x = -297; x < 300; x += 19)
      expect(positive(x, y) > 0, `${x},${y}`).toBe(read(x, y) > 0);
  const topology = createAdaptiveTopology([-300, -300, 300, 300], {
    maximumSize: 150,
    minimumSize: 150,
  });
  const shape = fieldContour(
    topology,
    positive,
    undefined,
    0,
    10,
    positive.enclose,
    positive.segment
  )!;
  expect(Math.abs(spatial.area(shape) - Math.PI * 250 ** 2)).toBeLessThan(2 * Math.PI * 250 * 10);
  expect(spatial.pointCoverage(shape)({ x: 240, y: 0, z: 0 })).toBe(true);
  expect(spatial.pointCoverage(shape)({ x: 260, y: 0, z: 0 })).toBe(false);
});
it("rejects negative jets and preserves clamped zero-corner regions", () => {
  const support = {
    x: Float64Array.of(0, 1, 0, 1),
    y: Float64Array.of(0, 0, 1, 1),
    origin: [0, 0] as [number, number],
    spacing: 1,
  };
  const coefficients = { dx: new Float64Array(4), dy: new Float64Array(4), affine: false };
  const positive = samplePositiveSupport(support, Float64Array.of(0, 1, 1, 1), coefficients)!;
  expect(positive(-1, -1)).toBeLessThanOrEqual(0);
  expect(positive(-1, 0.5)).toBeGreaterThan(0);
  for (let x = -3; x <= 3; x += 0.13)
    for (let y = -3; y <= 3; y += 0.17)
      expect(positive(x, y)).toBeCloseTo(positive.enclose([x, y, x, y]).range[0], 12);
  coefficients.dx[0] = 1;
  expect(samplePositiveSupport(support, Float64Array.of(1, 1, 1, 1), coefficients)).toBeNull();
});
