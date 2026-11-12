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
import { groundResourceChannels } from "../rock/groundResources";

function suppliedField() {
  const state = landscape(),
    footprint = rectangle([0, 0, 1000, 1000]);
  state.domain.world.areas.area.footprint = footprint;
  // A kilometre of ground is a site: its fixed cell size gives the import cells to fill.
  state.domain.world.areas.area.profile = "site";
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
  for (const { name, unit } of groundResourceChannels)
    putChannel(
      state.surface,
      name,
      unit,
      generateChannel(state.surface, name, (i) =>
        name === "BedrockElevation" || name === "CrustSupportElevation"
          ? (gridPosition(state.surface, i).x - 125) * 1024
          : 0
      )
    );
  for (const [name, unit, scale] of [
    ["Elevation", "native-length", 1024],
    ["GrassCover", "ratio", 1 / 750],
    ["MaximumIceFlux", "cubic-metre/year", 100],
    ["VolcanicConstructionHistory", "native-length", 1024],
    ["CumulativeFluvialErosion", "native-length", 1024],
    ["SedimentThickness", "native-length", 1024],
    ["SurfaceRockLoad", "native-length", 1024],
    ["WindX", "per-mille", 1000 / 750],
  ] as const)
    putChannel(
      state.surface,
      name,
      unit,
      generateChannel(state.surface, name, (i) => (gridPosition(state.surface, i).x - 125) * scale)
    );
  for (const name of ["BaseSeaLevel", "EffectiveSeaLevel"] as const)
    putChannel(
      state.surface,
      name,
      "native-length",
      generateChannel(state.surface, name, () => 0)
    );
  return state;
}

it("imports bounded ecological fractions and nonnegative ice history without restricting elevation", () => {
  const state = suppliedField();
  const before = Object.fromEntries(
    Object.entries(state.surface.channels).map(([name, band]) => [name, Array.from(band!)])
  );
  expect(before.GrassCover.every((value) => value >= 0 && value <= 1)).toBe(true);
  expect(before.MaximumIceFlux.every((value) => value >= 0)).toBe(true);
  const at = fieldInterpolator(state.surface, "Elevation"),
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
    expect(work.map.Elevation.get(i)).toBeCloseTo(at(nativePosition(work, i)), 8);
  expect(
    Object.fromEntries(
      Object.entries(state.surface.channels).map(([name, band]) => [name, Array.from(band!)])
    )
  ).toEqual(before);
});
