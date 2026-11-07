import { expect, it } from "vitest";
import {
  createAdaptiveField,
  createAdaptiveTopology,
  generateChannel,
  gridPosition,
  putChannel,
  rectangle,
  fieldInterpolator,
} from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { createAtlasWorkspace, nativePosition } from "./atlasWorkspace";

it("imports bounded ecological fractions and nonnegative ice history without restricting elevation", () => {
  const state = landscape(),
    footprint = rectangle([0, 0, 1000, 1000]);
  state.domain.world.areas.area.footprint = footprint;
  state.domain.world.reference.domain = footprint;
  state.domain.scope = { ...state.domain.scope, footprint };
  state.surface = createAdaptiveField(
    "supplied",
    state.domain.scope,
    createAdaptiveTopology([0, 0, 1000, 1000], {
      maximumSize: 250,
      minimumSize: 250,
      refine: () => false,
    })
  );
  for (const [name, unit, scale] of [
    ["elevation", "metre", 1],
    ["grassCover", "ratio", 1 / 750],
    ["maximumIceFlux", "cubic-metre/year", 100],
    ["volcanicConstruction", "metre", 1],
    ["fluvialErosion", "metre", 1],
    ["sediment", "metre", 1],
    ["rockLoad", "metre", 1],
    ["windEast", "ratio", 1 / 750],
  ] as const)
    putChannel(
      state.surface,
      name,
      unit,
      generateChannel(state.surface, name, (i) => (gridPosition(state.surface, i).x - 125) * scale)
    );
  const before = Object.fromEntries(
    Object.entries(state.surface.channels).map(([name, band]) => [name, Array.from(band)])
  );
  expect(before.grassCover.every((value) => value >= 0 && value <= 1)).toBe(true);
  expect(before.maximumIceFlux.every((value) => value >= 0)).toBe(true);
  const at = fieldInterpolator(state.surface, "elevation"),
    work = createAtlasWorkspace(state, "draft");
  expect(Array.from(work.map.GrassCover).every((value) => value >= 0 && value <= 1)).toBe(true);
  expect(Array.from(work.map.MaximumIceFlux).every((value) => value >= 0)).toBe(true);
  for (const name of [
    "VolcanicConstructionHistory",
    "CumulativeFluvialErosion",
    "SedimentThickness",
  ] as const)
    expect(
      Array.from(work.map[name]).every((value) => value >= 0),
      name
    ).toBe(true);
  expect(Array.from(work.map.SurfaceRockLoad).some((value) => value < 0)).toBe(true);
  expect(Array.from(work.map.WindX).some((value) => value < 0)).toBe(true);
  expect(Array.from(work.map.Elevation).some((value) => value < 0)).toBe(true);
  for (let i = 0; i < work.map.mesh.count; i++)
    expect(work.map.Elevation.get(i)).toBeCloseTo(at(nativePosition(work, i)) * 1024, 8);
  expect(
    Object.fromEntries(
      Object.entries(state.surface.channels).map(([name, band]) => [name, Array.from(band)])
    )
  ).toEqual(before);
});
