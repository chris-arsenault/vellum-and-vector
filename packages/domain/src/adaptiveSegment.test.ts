import { expect, it } from "vitest";
import { createAdaptiveTopology, adaptiveCell } from "./adaptiveTopology";
import { prepareAdaptiveCoefficients, preparedAdaptiveInterpolator } from "./adaptivePoint";
import { adaptiveSegmentReader } from "./adaptiveSegment";
import { prepareAdaptiveCell } from "./adaptiveHermite";
import { preparedValue } from "./preparedField";

it("bounds directed spline segments across coarse and fine faces", () => {
  const topology = createAdaptiveTopology([-200, -100, 200, 100], {
    maximumSize: 100,
    minimumSize: 25,
    refine: (b) => b[0] < 50 && b[2] > -50,
  });
  const field = prepareAdaptiveCoefficients(topology, (i) => {
    const b = adaptiveCell(topology, i);
    return Math.sin((b[0] + b[2]) / 71) + Math.cos((b[1] + b[3]) / 59);
  });
  const segment = adaptiveSegmentReader(field),
    read = preparedAdaptiveInterpolator(field);
  const paths: [[number, number], [number, number]][] = [
    [
      [190, 90],
      [-190, -90],
    ],
    [
      [-190, 0],
      [190, 0],
    ],
    [
      [1, 80],
      [1, -80],
    ],
    [
      [3, 3],
      [3, 3],
    ],
  ];
  for (const [a, b] of paths) {
    const bounds = segment(a, b);
    const at = (t: number) => read(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
    for (let i = 0; i <= 100; i++) {
      const t = i / 100,
        value = at(t);
      expect(value).toBeGreaterThanOrEqual(bounds.range[0] - 1e-12);
      expect(value).toBeLessThanOrEqual(bounds.range[1] + 1e-12);
      if (i === 0 || i === 100) continue;
      const h = 1e-6,
        d = (at(t + h) - at(t - h)) / (2 * h);
      expect(d).toBeGreaterThanOrEqual(bounds.derivative[0] - 1e-7);
      expect(d).toBeLessThanOrEqual(bounds.derivative[1] + 1e-7);
    }
  }
});
it("traces the same positive history using the signed polynomial beneath a zero clamp", () => {
  const topology = createAdaptiveTopology([0, 0, 100, 100], { maximumSize: 25, minimumSize: 25 });
  const values = Float64Array.from(topology.leaves, (_, i) => {
    const b = adaptiveCell(topology, i);
    return b[0] < 50 && b[1] < 75 ? 500 : 0;
  });
  const field = prepareAdaptiveCoefficients(topology, values);
  const support = {
    x: new Float64Array(values.length),
    y: new Float64Array(values.length),
    origin: [0, 0] as [number, number],
    spacing: 25,
  };
  const read = preparedValue(support, values, { adaptive: field }),
    positive = read.positiveSupport()!;
  expect(positive).not.toBeNull();
  for (let x = 1; x < 100; x += 3)
    for (let y = 1; y < 100; y += 3) expect(positive(x, y) > 0).toBe(read(x, y) > 0);
  const a: [number, number] = [19, 21],
    b: [number, number] = [91, 87],
    bounds = positive.segment(a, b);
  for (let i = 0; i <= 100; i++) {
    const t = i / 100,
      value = positive(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
    expect(value).toBeGreaterThanOrEqual(bounds.range[0] - 1e-10);
    expect(value).toBeLessThanOrEqual(bounds.range[1] + 1e-10);
  }
});
it("retains directional cancellation instead of projecting a rectangle gradient", () => {
  const topology = createAdaptiveTopology([0, 0, 1, 1], { maximumSize: 1, minimumSize: 1 });
  const corners = Float64Array.from([0, 1, -1, 0, 1, 1, -1, 0, -1, 1, -1, 0, 0, 1, -1, 0]);
  const field = { topology, cells: [prepareAdaptiveCell(corners, 0)] };
  const bound = adaptiveSegmentReader(field)([0.1, 0.1], [0.9, 0.9]);
  expect(Math.max(...bound.derivative.map(Math.abs))).toBeLessThan(1e-14);
  expect(Math.max(...bound.range.map(Math.abs))).toBeLessThan(1e-14);
});
