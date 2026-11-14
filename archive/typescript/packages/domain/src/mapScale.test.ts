import { expect, it } from "vitest";
import { MapScale } from "./mapScale";

it("resolves relative dimensions with one map law while keeping resolution separate", () => {
  const map = new MapScale(4_000_000, 3_000_000, 20_000),
    smaller = new MapScale(2_000_000, 1_500_000, 20_000),
    finer = new MapScale(4_000_000, 3_000_000, 2_000),
    definitions = MapScale.definitions({
      reach: MapScale.length(0.065),
      catchment: MapScale.area(0.001),
      cargo: MapScale.volume(0.00001),
      attenuation: MapScale.inverseLength(100),
      gain: 0.7,
    }),
    full = map.resolve(definitions),
    half = smaller.resolve(definitions);
  expect(full.reach).toBe(260_000);
  expect(half.reach).toBe(full.reach / 2);
  expect(half.catchment).toBe(full.catchment / 4);
  expect(half.cargo).toBe(full.cargo / 8);
  expect(half.attenuation).toBe(full.attenuation * 2);
  expect(half.gain).toBe(full.gain);
  expect(finer.resolve(definitions).reach).toBe(full.reach);
  expect(finer.cells(2)).toBe(4000);
  expect(map.cells(2)).toBe(40_000);
});

it("uses equal-area map scale independently of translation and aspect ratio", () => {
  const wide = MapScale.fromBounds([100, 200, 4_000_100, 3_000_200], 1000),
    tall = new MapScale(2_000_000, 6_000_000, 1000);
  expect(wide.length(0.01)).toBe(tall.length(0.01));
  expect(wide.fraction(wide.length(0.015))).toBeCloseTo(0.015);
  expect(wide.areaFraction(wide.area(0.02))).toBeCloseTo(0.02);
});

it("applies explicit nonlinear laws to dimensionless size ratios", () => {
  const map = new MapScale(16_000_000, 12_000_000, 1000);
  expect(map.length(0.01, 0.5)).toBe(80_000);
  expect(map.length(0.01)).toBe(160_000);
  expect(map.resolveMeasure(MapScale.measure(2, 0.5))).toBe(8000);
  expect(() => map.length(0.01, 0)).toThrow("positive");
});

it("resolves overrides as fractions and rejects a second resolution of a numerical profile", () => {
  const map = new MapScale(2_000_000, 1_500_000, 1000),
    definition = MapScale.definitions({ radius: MapScale.length(0.01), count: 3 }),
    resolved = map.resolve(definition, { radius: 0.02, count: 5 });
  expect(resolved).toMatchObject({ radius: 40_000, count: 5 });
  // @ts-expect-error Resolved settings are not a relative definition.
  expect(() => map.resolve(resolved)).toThrow("already resolved");
  // @ts-expect-error Resolved settings cannot become relative overrides either.
  expect(() => map.resolve(definition, resolved)).toThrow("already resolved");
  // @ts-expect-error Object spread preserves the resolved-settings brand.
  expect(() => map.resolve(definition, { ...resolved })).toThrow("already resolved");
});

it("changes encoding of placed data without applying map-size scaling", () => {
  expect(MapScale.metres(12.5, "km")).toBe(12_500);
  expect(MapScale.native(-12.5)).toBe(-12_800);
  expect(MapScale.metres(-12_800, "native")).toBe(-12.5);
  expect(MapScale.areaUnits(2, "km2", "m2")).toBe(2_000_000);
  expect(MapScale.volumeUnits(2.5, "km3", "m3")).toBe(2_500_000_000);
  expect(MapScale.volumeUnits(250_000_000, "m3", "km3")).toBe(0.25);
});

it("resolves nested and array-valued declarations without leaking unresolved measures", () => {
  const map = new MapScale(2_000_000, 1_500_000, 1000),
    definition = MapScale.definitions({
      layers: [{ depth: MapScale.length(0.0001) }],
      radii: [MapScale.length(0.01)],
    });
  expect(map.resolve(definition, { radii: [0.02] })).toMatchObject({
    layers: [{ depth: 200 }],
    radii: [40_000],
  });
});

it("derives sampling from map area and an explicit cell count", () => {
  const map = MapScale.fromCells([0, 0, 200, 100], 200);
  expect(map.cellSpan).toBe(10);
  expect(map.resolution(200)).toEqual({ cellArea: 100, cellSpan: 10, cellAreaKm2: 0.0001 });
  expect(() => new MapScale(0, 100, 1)).toThrow("positive");
});
