import { expect, it } from "vitest";
import { smoothSampleInterpolator, type SampleSupport } from "./smoothSamples";
import { createGrid, fieldInterpolator, putChannel, type Grid } from "./grids";
import { gridSchema } from "./gridSchema";
import { gridSurfaceSchema } from "./gridSurfaceSchema";
import { rectangle } from "./spatial";
import { overlayField, replaceChannel } from "./fieldComposition";
import { fieldExtrema } from "./fieldExtrema";
import { prepareGridChannel, preparedChannel } from "./preparedField";
import { validateFieldTraits } from "./traits";
import { weightEnclosure } from "./smoothSampleBounds";
import type { Area } from "./model";

const support: SampleSupport = {
  x: Float64Array.from({ length: 121 }, (_, i) => i % 11),
  y: Float64Array.from({ length: 121 }, (_, i) => Math.floor(i / 11)),
  origin: [2_000_000, 3_000_000],
  spacing: 1,
};
function prepare(grid: Grid) {
  grid.prepared ??= { support, coefficients: {}, transforms: {} };
  for (const name of Object.keys(grid.channels)) prepareGridChannel(grid, name);
}
it("retains other sources when one compact weight can dominate the enclosure", () => {
  for (const high of [1e30, Infinity]) {
    const terms = [
      { low: 0.4, high: 0.4, weightLow: 1, weightHigh: 1 },
      { low: -0.1, high: -0.1, weightLow: 1, weightHigh: high },
    ];
    for (const ordered of [terms, [...terms].reverse()]) {
      const [low, upper] = weightEnclosure(ordered);
      // Equal admissible weights produce .15, even when another admissible
      // configuration overwhelmingly favors the negative source.
      expect(low).toBeLessThanOrEqual(-0.1 + 1e-15);
      expect(upper).toBeGreaterThanOrEqual(0.15 - 1e-15);
    }
  }
});
it("resolves a small local field beside a distant source with negligible weight", () => {
  const terms = [
    { low: -0.4, high: -0.4, weightLow: 0, weightHigh: 1e-10 },
    { low: 1e-7, high: 1e-7, weightLow: 0.99, weightHigh: 1.01 },
    { low: 2e-7, high: 2e-7, weightLow: 0.99, weightHigh: 1.01 },
  ];
  const [low, high] = weightEnclosure(terms, 1.5e-7);
  expect(low).toBeGreaterThan(1.4e-7);
  expect(high).toBeLessThan(1.6e-7);
  for (const first of [0, 1e-10])
    for (const second of [0.99, 1.01])
      for (const third of [0.99, 1.01]) {
        const value = (-0.4 * first + 1e-7 * second + 2e-7 * third) / (first + second + third);
        expect(value).toBeGreaterThanOrEqual(low);
        expect(value).toBeLessThanOrEqual(high);
      }
});
it("reproduces metre planes, exact samples and process mutations", () => {
  const values = Float64Array.from(support.x, (x, i) => 700 + 3 * x - support.y[i]);
  let at = smoothSampleInterpolator(support, values);
  expect(at(2_000_004.3, 3_000_005.8)).toBeCloseTo(700 + 3 * 4.3 - 5.8, 7);
  expect(at(2_000_005, 3_000_005)).toBe(710);
  values.fill(20);
  at = smoothSampleInterpolator(support, values);
  expect(at(2_000_004.3, 3_000_005.8)).toBeCloseTo(20, 10);
});
it("joins slopes across sample sites, support edges and former cell boundaries", () => {
  const values = Float64Array.from(
    support.x,
    (x, i) => Math.sin(x / 3) * Math.cos(support.y[i] / 4)
  );
  const read = smoothSampleInterpolator(support, values),
    h = 1e-5;
  const at = (x: number) => read(2_000_000 + x, 3_000_005);
  for (const x of [3, 3.5, 4, 4.5, 5]) {
    const left = (at(x) - at(x - h)) / h,
      right = (at(x + h) - at(x)) / h;
    expect(Math.abs(left - right)).toBeLessThan(1e-4);
  }
});
it("joins values and slopes when an extreme source leaves compact support", () => {
  const lattice = {
    x: Float64Array.from({ length: 81 }, (_, i) => i % 9),
    y: Float64Array.from({ length: 81 }, (_, i) => Math.floor(i / 9)),
    origin: [0, 0] as [number, number],
    spacing: 1,
  };
  const values = new Float64Array(81).fill(5);
  values[51] = 8;
  values[61] = 0;
  const at = smoothSampleInterpolator(lattice, values),
    angle = (9 * Math.PI) / 8,
    x = 7 + 2.5 * Math.cos(angle),
    y = 6 + 2.5 * Math.sin(angle),
    read = (d: number) => at(x + d * Math.cos(angle), y + d * Math.sin(angle));
  for (const h of [1e-4, 1e-6, 1e-8]) {
    expect(Math.abs(read(h) - read(-h))).toBeLessThan(h * 10);
    expect(Math.abs((read(0) - read(-h)) / h - (read(h) - read(0)) / h)).toBeLessThan(1e-3);
  }
});
it("encloses queries straddling the edge of numerical support", () => {
  const at = smoothSampleInterpolator(
    support,
    Float64Array.from(support.x, (x) => Math.sin(x / 3))
  );
  const data = at.enclose([2e6 - 1, 3e6 + 4.3, 2e6 + 0.001, 3e6 + 4.3]);
  for (const x of [-1, -0.5, 0, 0.0005, 0.001]) {
    expect(at(2e6 + x, 3e6 + 4.3)).toBeGreaterThanOrEqual(data.range[0] - 1e-12);
    expect(at(2e6 + x, 3e6 + 4.3)).toBeLessThanOrEqual(data.range[1] + 1e-12);
  }
  expect(data.gradient[0][0]).toBeLessThanOrEqual(0);
  expect(data.gradient[0][1]).toBeGreaterThanOrEqual(0);
  const outside = at.enclose([2e6 - 100, 3e6 + 4.3, 2e6 - 99, 3e6 + 4.3]);
  expect(outside.range[0]).toBeLessThanOrEqual(at(2e6 - 100, 3e6 + 4.3));
  expect(outside.range[1]).toBeGreaterThanOrEqual(at(2e6 - 100, 3e6 + 4.3));
});
it("keeps fractional cover inside its physical sample range, including near-zero fields", () => {
  for (const scale of [1, 1e-14, 1e-48]) {
    const values = Float64Array.from(support.x, (x) => Math.max(0, x - 5) * scale);
    const at = smoothSampleInterpolator(support, values);
    for (let x = 0; x <= 10; x += 0.17) {
      const value = at(2e6 + x, 3e6 + 4.1);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(5 * scale);
    }
  }
});

it("encloses values and directed derivatives on interior and clamped segments", () => {
  const at = smoothSampleInterpolator(
    support,
    Float64Array.from(support.x, (x, i) => Math.sin(x / 3) * Math.cos(support.y[i] / 4))
  );
  for (let i = 0; i < 40; i++) {
    const a: [number, number] = [2e6 - 0.8 + ((i * 0.17) % 8), 3e6 + 1 + ((i * 0.31) % 8)],
      b: [number, number] = [2e6 + 1 + ((i * 0.43) % 8), 3e6 + 1 + ((i * 0.29) % 8)],
      data = at.segment(a, b),
      read = (t: number) => at(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
    for (const t of [0.1, 0.3, 0.6, 0.9]) {
      expect(read(t)).toBeGreaterThanOrEqual(data.range[0] - 1e-12);
      expect(read(t)).toBeLessThanOrEqual(data.range[1] + 1e-12);
      const derivative = (read(t + 1e-4) - read(t - 1e-4)) / 2e-4;
      expect(derivative).toBeGreaterThanOrEqual(data.derivative[0] - 1e-4);
      expect(derivative).toBeLessThanOrEqual(data.derivative[1] + 1e-4);
    }
  }
});

it("retains physical support through cloning and lets authored patches replace it", () => {
  const grid = createGrid(
    "shared",
    {
      worldId: "world",
      areaId: "area",
      spaceId: "surface",
      crsId: "metres",
      footprint: rectangle([2e6, 3e6, 2e6 + 10, 3e6 + 10]),
      time: "present",
      revision: 1,
      resolution: 5,
    },
    11,
    11
  );
  const values = Float64Array.from(support.x, (x, i) => 3 * x - support.y[i]);
  putChannel(grid, "elevation", "metre", values);
  prepare(grid);
  const peak = structuredClone(grid);
  peak.channels.elevation.fill(0);
  peak.channels.elevation[48] = 100;
  prepare(peak);
  expect(fieldExtrema(peak, "elevation", peak.scope.footprint)![1]).toBe(100);
  const copy = gridSchema.parse(structuredClone(grid));
  const position = { x: 2e6 + 4.3, y: 3e6 + 5.8, z: 0 };
  expect(fieldInterpolator(copy, "elevation")(position)).toBeCloseTo(7.1, 8);
  const total = Float64Array.from(support.x, (x, i) => 100 + 90 * Math.sin(x + support.y[i]));
  putChannel(copy, "maximumIceFlux", "cubic-metre/year", total);
  putChannel(
    copy,
    "maximumGroundedIceFlux",
    "cubic-metre/year",
    Float64Array.from(total, (value, i) => value * ((i % 5) / 4))
  );
  const ice = fieldInterpolator(copy, "maximumIceFlux");
  const grounded = fieldInterpolator(copy, "maximumGroundedIceFlux");
  for (let x = 0.1; x < 10; x += 0.17) {
    const p = { x: 2e6 + x, y: 3e6 + 4.1, z: 0 };
    expect(grounded(p)).toBeLessThanOrEqual(ice(p));
    expect(grounded(p)).toBeGreaterThanOrEqual(0);
  }
  const region = rectangle([2e6 + 4.2, 3e6 + 4.1, 2e6 + 4.3, 3e6 + 4.2]),
    range = fieldExtrema(copy, "maximumGroundedIceFlux", region)!;
  for (let x = 4.2; x < 4.3; x += 0.01)
    for (let y = 4.1; y < 4.2; y += 0.01) {
      const value = grounded({ x: 2e6 + x, y: 3e6 + y, z: 0 });
      expect(value).toBeGreaterThanOrEqual(range[0] - 1e-5);
      expect(value).toBeLessThanOrEqual(range[1] + 1e-5);
    }
  const patch = structuredClone(copy);
  patch.channels.elevation.fill(99);
  prepare(patch);
  overlayField(copy, patch);
  expect(() => gridSurfaceSchema.parse(copy)).not.toThrow();
  const invalid = gridSurfaceSchema.parse(structuredClone(copy));
  invalid.overlays![0].grid.units.elevation = "celsius";
  expect(() => gridSurfaceSchema.parse(invalid)).toThrow();
  expect(fieldInterpolator(copy, "elevation")(position)).toBe(99);
  replaceChannel(copy, "elevation", "metre", new Float64Array(121).fill(23));
  expect(fieldInterpolator(copy, "elevation")(position)).toBe(23);
});
it("does not invent a grounded-flux peak when total flux and grounded fraction vary oppositely", () => {
  const source = {
    support,
    channels: {
      maximumIceFlux: Float64Array.from(support.x, (x) => (x < 5 ? 100 : 20)),
      maximumGroundedIceFlux: Float64Array.from(support.x, (x) => (x < 5 ? 10 : 18)),
    },
  };
  const grid = createGrid(
    "flux",
    {
      worldId: "world",
      areaId: "area",
      spaceId: "surface",
      crsId: "metres",
      footprint: rectangle([2e6, 3e6, 2e6 + 10, 3e6 + 10]),
      time: "present",
      revision: 1,
      resolution: 1,
    },
    11,
    11
  );
  for (const [name, values] of Object.entries(source.channels))
    putChannel(grid, name, "cubic-metre/year", values);
  prepare(grid);
  const at = preparedChannel(grid, "maximumGroundedIceFlux");
  expect(at({ x: 2e6 + 4.5, y: 3e6 + 5.1, z: 0 })).toBeLessThanOrEqual(18);
});

it("validates scoped constraints against the field inside their footprint", () => {
  const scope = {
    worldId: "world",
    areaId: "area",
    spaceId: "surface",
    crsId: "metres",
    footprint: rectangle([2e6, 3e6, 2e6 + 10, 3e6 + 10]),
    time: "present",
    revision: 1,
    resolution: 1,
  };
  const grid = createGrid("scoped", scope, 11, 11);
  putChannel(grid, "elevation", "metre", support.x);
  prepare(grid);
  const region = rectangle([2e6 + 4, 3e6 + 4, 2e6 + 4.1, 3e6 + 4.1]);
  const range = fieldExtrema(grid, "elevation", region)!;
  expect(range[0]).toBeCloseTo(4, 6);
  expect(range[1]).toBeCloseTo(4.1, 6);
  const area = {
    footprint: scope.footprint,
    traits: [{ kind: "hard", field: "elevation", minimum: 3, maximum: 5, scope: region }],
  } as unknown as Area;
  expect(() => validateFieldTraits(area, grid, "elevation")).not.toThrow();
  area.traits[0].maximum = 4.05;
  expect(() => validateFieldTraits(area, grid, "elevation")).toThrow();
});

it("encloses nonlinear field values and finds scoped extrema without including remote peaks", () => {
  const values = Float64Array.from(
    support.x,
    (x, i) => 100 * Math.sin(x / 3) * Math.cos(support.y[i] / 4)
  );
  const at = smoothSampleInterpolator(support, values),
    candidates = Array.from(values.keys());
  for (const box of [
    [2e6 + 3.1, 3e6 + 3.1, 2e6 + 6.9, 3e6 + 6.9],
    [2e6 + 4, 3e6 + 4, 2e6 + 4.01, 3e6 + 4.01],
  ] as [number, number, number, number][]) {
    const bounds = at.bounds(box, candidates);
    for (let row = 0; row <= 8; row++)
      for (let col = 0; col <= 8; col++) {
        const value = at(
          box[0] + ((box[2] - box[0]) * col) / 8,
          box[1] + ((box[3] - box[1]) * row) / 8
        );
        expect(value).toBeGreaterThanOrEqual(bounds[0] - 1e-9);
        expect(value).toBeLessThanOrEqual(bounds[1] + 1e-9);
      }
  }
  const grid = createGrid(
    "nonlinear",
    {
      worldId: "world",
      areaId: "area",
      spaceId: "surface",
      crsId: "metres",
      footprint: rectangle([2e6, 3e6, 2e6 + 10, 3e6 + 10]),
      time: "present",
      revision: 1,
      resolution: 1,
    },
    11,
    11
  );
  putChannel(grid, "elevation", "metre", values);
  prepare(grid);
  const region = rectangle([2e6 + 3.1, 3e6 + 3.1, 2e6 + 6.9, 3e6 + 6.9]),
    range = fieldExtrema(grid, "elevation", region)!;
  const point = { type: "Point" as const, coordinates: [2e6 + 4.1, 3e6 + 4.2] };
  expect(fieldExtrema(grid, "elevation", point)).toEqual([
    at(...(point.coordinates as [number, number])),
    at(...(point.coordinates as [number, number])),
  ]);
  const line = fieldExtrema(grid, "elevation", {
    type: "LineString",
    coordinates: [
      [2e6 + 4.1, 3e6 + 4.2],
      [2e6 + 6.2, 3e6 + 4.2],
    ],
  })!;
  for (let x = 4.1; x < 6.2; x += 0.1) {
    expect(at(2e6 + x, 3e6 + 4.2)).toBeGreaterThanOrEqual(line[0] - 1e-5);
    expect(at(2e6 + x, 3e6 + 4.2)).toBeLessThanOrEqual(line[1] + 1e-5);
  }
  expect(range[1]).toBeLessThan(80);
  for (let x = 3.1; x < 6.9; x += 0.13)
    for (let y = 3.1; y < 6.9; y += 0.17) {
      const value = at(2e6 + x, 3e6 + y);
      expect(value).toBeGreaterThanOrEqual(range[0] - 1e-5);
      expect(value).toBeLessThanOrEqual(range[1] + 1e-5);
    }
});
