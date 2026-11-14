import { expect, it } from "vitest";
import {
  defaultLandmarkParameters,
  generatedLandmarkMeasures,
  landmarkKind,
  MapScale,
} from "@atlas/domain";
import { clampMeasures, seededMeasures } from "./landmarkSiting";

it("resolves new landmark dimensions while preserving recorded catalogue units", () => {
  const large = MapScale.reference(25_000),
    small = new MapScale(2_000_000, 1_500_000, 12_500),
    kind = landmarkKind("falls")!,
    authored = defaultLandmarkParameters(kind),
    full = generatedLandmarkMeasures(kind, large),
    half = generatedLandmarkMeasures(kind, small);
  for (let i = 0; i < full.length; i++) {
    const ratio = full[i].key === "discharge" ? 1 / 8 : 1 / 2;
    expect(half[i].default).toBeCloseTo(full[i].default * ratio);
    expect(half[i].max).toBeCloseTo(full[i].max * ratio);
  }
  expect(authored).toEqual({ drop: 50, discharge: 2400, captureDistance: 50 });
  expect(kind.reach(authored)).toBe(50_000);
  expect(defaultLandmarkParameters(kind)).toEqual(authored);
});

it("keeps generated bounds and small lengths relative without a fixed rounding floor", () => {
  const scale = new MapScale(400, 300, 1),
    kind = landmarkKind("dome-ring")!,
    measures = generatedLandmarkMeasures(kind, scale),
    seeded = seededMeasures(kind.id, 7, 0, scale),
    clamped = clampMeasures(kind.id, { diameter: -1, ringRelief: 100, ringCount: 2.4 }, scale);
  expect(seeded.diameter).toBeGreaterThan(0);
  expect(seeded.diameter).toBeLessThan(0.01);
  expect(clamped.diameter).toBe(measures.find((p) => p.key === "diameter")!.min);
  expect(clamped.ringRelief).toBe(measures.find((p) => p.key === "ringRelief")!.max);
  expect(clamped.ringCount).toBe(2);
  expect(measures.find((p) => p.key === "ringCount")!.default).toBe(3);
});
