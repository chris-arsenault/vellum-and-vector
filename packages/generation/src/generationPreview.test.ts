import { expect, it } from "vitest";
import { generationPreview } from "./generationPreview";
import { landscape } from "./mapFixtures";
import { createField } from "./canonry/field";
import { createWorldMesh } from "./canonry/worldMesh";
import { atlasPhysicalProfile } from "./canonry/atlasProfile";

it("samples a bounded independent display grid without modifying live surface channels", () => {
  const state = landscape();
  const original = structuredClone(state.surface);
  const preview = generationPreview(state);
  expect(preview.width).toBe(128);
  expect(preview.height).toBeLessThan(128);
  expect(preview.channels.elevation.length).toBe(preview.width * preview.height);
  expect(preview.channels.elevation.buffer).not.toBe(state.surface.channels.elevation.buffer);
  structuredClone(preview, { transfer: [preview.channels.elevation.buffer] });
  expect(state.surface).toEqual(original);
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
    samples: new Int32Array(),
    fixed: [],
    inherited: false,
    sampling: { maximumSize: 500, minimumSize: 500, featureSamples: 1 },
  };
  const preview = generationPreview(state);
  const values = preview.channels.elevation.filter((_, i) => preview.active[i] !== 0);
  expect(values.length).toBeGreaterThan(0);
  expect(values.every((height) => height === 25)).toBe(true);
  expect(map.Elevation[0]).toBe(1024 * 125);
  expect(state.surface.channels.elevation[0]).not.toBe(25);
});
