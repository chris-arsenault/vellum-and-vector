import { expect, it } from "vitest";
import { MapScale } from "@atlas/domain";
import type { PhysicalField } from "../../../packages/generation/src/world/field";
import { highGroundAtEdge, mountainSystems, reliefThresholds, widthsAbove } from "./reliefSystems";

/** Two supplied six-cell bodies: a high edge belt and a lower, level inland belt. */
function supplied(factor: number, highActive = true) {
  const width = 4_000_000 * factor,
    height = 3_000_000 * factor,
    spacing = 50_000 * factor,
    band = (get: (i: number) => number) => ({ get });
  return {
    scale: new MapScale(width, height, spacing),
    EffectiveSeaLevel: 0,
    Elevation: band((i) => MapScale.inUnits((i < 6 ? 3000 : 1000) * factor, "native")),
    OceanDistance: band(() => 200_000 * factor),
    LandmassIds: band(() => 1),
    OrogenicConstruction: band((i) => Number(i < 6 ? highActive : !highActive)),
    ThrustSheetIndex: band(() => 1),
    CrustSutureStrength: band(() => 0),
    VolcanicConstructionHistory: band(() => MapScale.inUnits(150 * factor, "native")),
    mesh: {
      count: 12,
      spacing,
      bounds: [0, 0, width, height],
      origin: [0, 0],
      membership: () => 1,
      degree: () => 2,
      neighbor: (i: number, edge: number) => {
        const next = i + (edge === 0 ? -1 : 1);
        return next >= 0 && next < 12 && Math.floor(next / 6) === Math.floor(i / 6) ? next : -1;
      },
      x: (i: number) => width * ((i < 6 ? 0.03 : 0.4) + (i % 6) * 0.005),
      y: () => height / 2,
      area: () => spacing ** 2,
      cellAt: () => 0,
    },
  } as unknown as PhysicalField;
}

it.each([0.5, 1, 2])("classifies the same normalized supplied terrain at scale %s", (factor) => {
  const map = supplied(factor),
    edge = highGroundAtEdge(map),
    widths = widthsAbove(map),
    systems = mountainSystems(map);
  expect(edge).toEqual({
    thresholdsMetres: { reach: 300_000 * factor, high: 2000 * factor },
    landNearEdge: 0.5,
    highGroundNearEdge: 1,
  });
  expect(widths.thresholdsMetres).toEqual([1000, 2000, 3000, 4000].map((m) => m * factor));
  expect(widths.bands.map((band) => band.cells)).toEqual([12, 6, 6, 0]);
  expect(systems[0]).toMatchObject({
    plainShare: 0.5,
    kinds: { "active-high": 1, "quiet-low-structured": 1 },
  });
  expect(systems[0].ranges.every((range) => range.volcanic === 1)).toBe(true);
});

it("keeps the reference thresholds and describes activity without assigning geological age", () => {
  expect(reliefThresholds(MapScale.reference())).toMatchObject({
    raisedFrom: 600,
    highFrom: 2500,
    volcanicFrom: 100,
    plainBelow: 1500,
    plainRelief: 200,
    plainInland: 150_000,
  });
  expect(mountainSystems(supplied(1, false))[0].kinds).toEqual({
    "quiet-high": 1,
    "active-low": 1,
  });
});
