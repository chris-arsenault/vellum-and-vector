import { expect, it } from "vitest";
import { generationPreview } from "./generationPreview";
import { landscape } from "./mapFixtures";
import { createField } from "./canonry/field";
import { createWorldMesh } from "./canonry/worldMesh";
import { atlasPhysicalProfile } from "./canonry/atlasProfile";
import { residentBand, rectangle, createGrid, putChannel, generateBand } from "@atlas/domain";

it("previews fractional field edges from real exported geography without rejecting boundary samples", () => {
  const state = landscape(),
    footprint = rectangle([3335862.959279, 390190.374797, 3659397.791327, 753521.126761]);
  state.surface = createGrid("fractional-region", { ...state.surface.scope, footprint }, 23, 31);
  putChannel(
    state.surface,
    "elevation",
    "metre",
    generateBand(state.surface.coverage, "float64", "height", (i) => i + 1)
  );
  const before = Array.from(state.surface.channels.elevation),
    preview = generationPreview(state);
  expect(Array.from(preview.channels.elevation).every(Number.isFinite)).toBe(true);
  expect(Array.from(state.surface.channels.elevation)).toEqual(before);
});

it("samples a bounded independent display grid without modifying live surface channels", () => {
  const state = landscape();
  const channels = () =>
    Object.fromEntries(
      Object.entries(state.surface.channels).map(([name, band]) => [name, Array.from(band)])
    );
  const original = channels();
  const preview = generationPreview(state);
  expect(preview.width).toBe(128);
  expect(preview.height).toBeLessThan(128);
  expect(preview.channels.elevation.length).toBe(preview.width * preview.height);
  expect(preview.coverage).not.toBe(state.surface.coverage);
  expect(preview.channels.elevation).not.toBe(state.surface.channels.elevation);
  preview.channels.elevation.fill(-1);
  expect(Object.keys(state.surface.channels)).toEqual(Object.keys(original));
  expect(channels()).toEqual(original);
});

it("uses evolved native terrain and its metre datum at epoch boundaries", () => {
  const state = landscape();
  const map = createField(createWorldMesh(state.surface.bounds, 64, 0));
  map.BaseSeaLevel = 1024 * 100;
  map.Elevation.fill(1024 * 125);
  const profile = atlasPhysicalProfile();
  state.physical = {
    map,
    profile,
    samples: residentBand("int32", []),
    grid: state.surface.coverage,
    fixed: [],
    inherited: false,
    sampling: { maximumSize: 500, minimumSize: 500, featureSamples: 1 },
  };
  const preview = generationPreview(state);
  const values = Array.from(preview.channels.elevation).filter(
    (_, i) => preview.active.get(i) !== 0
  );
  expect(values.length).toBeGreaterThan(0);
  expect(values.every((height) => height === 25)).toBe(true);
  expect(map.Elevation.get(0)).toBe(1024 * 125);
  expect(state.surface.channels.elevation.get(0)).not.toBe(25);
});
