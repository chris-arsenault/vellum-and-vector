import { expect, it } from "vitest";
import { createAdaptiveTopology, adaptiveGeometry } from "./adaptiveTopology";
import { fieldContour, contourSupport } from "./fieldContours";
import { adaptivePointSampler } from "./adaptivePoint";
import { point, rectangle, spatial } from "./spatial";

const topology = () =>
  createAdaptiveTopology([0, 0, 1000, 1000], {
    maximumSize: 125,
    minimumSize: 15.625,
    refine: ([x, y, right, top]) => x < 530 && right > 450 && y < 800 && top > 100,
  });
it("traces a continuous oblique shore across coarse/fine interfaces", () => {
  const angle = 0.37;
  const shore = fieldContour(
    topology(),
    (x, y) => {
      const a = (x - 500) * Math.cos(angle) + (y - 500) * Math.sin(angle);
      const b = -(x - 500) * Math.sin(angle) + (y - 500) * Math.cos(angle);
      return 1 - (a / 310) ** 2 - (b / 170) ** 2;
    },
    undefined,
    0,
    0.25
  )!;
  expect(spatial.area(shore) / (Math.PI * 310 * 170)).toBeGreaterThan(0.995);
  expect(spatial.area(shore) / (Math.PI * 310 * 170)).toBeLessThan(1.005);
  expect(spatial.covers(shore, point({ x: 500, y: 500, z: 0 }))).toBe(true);
  expect(spatial.covers(shore, point({ x: 900, y: 500, z: 0 }))).toBe(false);
});
it("retains islands, holes and the field's outer boundary without cell-strip unions", () => {
  const shape = fieldContour(
    topology(),
    (x, y) => Math.hypot(x - 500, y - 500) - 160,
    undefined,
    0,
    0.25
  )!;
  expect(spatial.area(shape)).toBeCloseTo(1_000_000 - Math.PI * 160 ** 2, -3);
  expect(spatial.covers(shape, point({ x: 10, y: 10, z: 0 }))).toBe(true);
  expect(spatial.covers(shape, point({ x: 500, y: 500, z: 0 }))).toBe(false);
});

it("closes staged lake shores reconstructed across nonuniform physical samples", () => {
  const tree = createAdaptiveTopology([0, 0, 1_000_000, 1_000_000], {
      maximumSize: 125_000,
      minimumSize: 15_625,
      refine: ([x, y, right, top]) =>
        x < 530_000 && right > 450_000 && y < 800_000 && top > 100_000,
    }),
    geometry = adaptiveGeometry(tree);
  for (let phase = 0; phase < 8; phase++) {
    const values = Float64Array.from(
      geometry.x,
      (x, i) => 100 * (Math.sin(x / 70_000 + phase) + Math.cos(geometry.y[i] / 45_000))
    );
    const members = Array.from(values.keys()).filter((i) => values[i] < 0);
    const floor = adaptivePointSampler(tree, values);
    const wet = adaptivePointSampler(tree, (i) => Number(values[i] < 0));
    expect(
      () =>
        fieldContour(
          tree,
          (x, y) => Math.min(-floor(x, y), (wet(x, y) - 0.1) * 1e6),
          contourSupport(tree, members),
          0
        ),
      `lake phase ${phase}`
    ).not.toThrow();
  }
});

it.each([0, 125, 500, 1000])(
  "closes an exact straight shore at x=%s, including cell vertices",
  (cut) => {
    const shape = fieldContour(topology(), (x) => x - cut, undefined, 0, 0.25);
    if (cut === 1000) expect(shape).toBeNull();
    else expect(spatial.area(shape!)).toBeCloseTo((1000 - cut) * 1000, 3);
  }
);

it("keeps disconnected islands separate and leaves the intervening water empty", () => {
  const shape = fieldContour(
    topology(),
    (x, y) => Math.max(120 - Math.hypot(x - 250, y - 500), 90 - Math.hypot(x - 750, y - 500)),
    undefined,
    0,
    0.1
  )!;
  expect(shape.type).toBe("MultiPolygon");
  expect(spatial.area(shape) / (Math.PI * (120 ** 2 + 90 ** 2))).toBeCloseTo(1, 2);
  for (const [x, covered] of [
    [250, true],
    [500, false],
    [750, true],
  ] as const)
    expect(spatial.covers(shape, point({ x, y: 500, z: 0 }))).toBe(covered);
});

it("matches full-field contours when restricted to a reconstructed feature's support", () => {
  const tree = topology(),
    geometry = adaptiveGeometry(tree);
  const members = Array.from(geometry.x.keys()).filter(
    (i) => Math.hypot(geometry.x[i] - 475, geometry.y[i] - 500) < 90
  );
  const membership = new Set(members);
  const at = adaptivePointSampler(tree, (i) => Number(membership.has(i)));
  const whole = fieldContour(tree, at, undefined, 0.1, 0.1)!;
  const local = fieldContour(tree, at, contourSupport(tree, members), 0.1, 0.1)!;
  expect(spatial.area(local)).toBeCloseTo(spatial.area(whole), 6);
  for (let y = 350; y <= 650; y += 17)
    for (let x = 325; x <= 625; x += 19) {
      const p = point({ x, y, z: 0 });
      expect(spatial.covers(local, p)).toBe(spatial.covers(whole, p));
    }
});

it.each(Array.from({ length: 16 }, (_, i) => i))(
  "polygonizes fragmented reconstructed labels, pattern %s",
  (phase) => {
    const tree = topology(),
      geometry = adaptiveGeometry(tree);
    const labels = Float64Array.from(geometry.x, (x, i) =>
      Number(Math.sin(x / 45 + phase) * Math.cos(geometry.y[i] / 37 - phase) > 0.1)
    );
    const at = adaptivePointSampler(tree, labels);
    const shape = fieldContour(tree, at, undefined, 0.5, 0.1)!;
    expect(spatial.area(shape)).toBeGreaterThan(0);
    expect(spatial.covers(rectangle([0, 0, 1000, 1000]), shape)).toBe(true);
    const covers = spatial.pointCoverage(shape);
    for (let y = 13; y < 1000; y += 61)
      for (let x = 17; x < 1000; x += 67) {
        const value = at(x, y);
        if (Math.abs(value - 0.5) < 0.1) continue;
        expect(covers({ x, y, z: 0 }), `coverage at ${x},${y}`).toBe(value > 0.5);
      }
  }
);
