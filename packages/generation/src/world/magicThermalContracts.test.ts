import { expect, it } from "vitest";
import { retainedSeaIce } from "./seaIce";
import { pressureAtDepth } from "./magicSources";
import { createTestField } from "../rock/groundTestFixture";
import { createWorldMesh } from "./worldMesh";
import { meltIce } from "../rock/groundSurfaceMedia";

it("preservation retains existing sea ice without creating ice or preventing all warm-water loss", () => {
  expect(retainedSeaIce(0, 1, 0, 2)).toBe(0);
  expect(retainedSeaIce(10, 0, 0, 2)).toBe(0);
  expect(retainedSeaIce(10, 0.8, 0, 2)).toBe(8);
  expect(retainedSeaIce(10, 0.8, 10, 2)).toBe(0);
  expect(retainedSeaIce(0.01, 1, 1, 2)).toBe(0);
});
it("water load increases Pressure source response smoothly from zero", () => {
  expect(pressureAtDepth(0, 100)).toBe(0);
  expect(pressureAtDepth(300, 100)).toBeGreaterThan(pressureAtDepth(30, 100));
});
it("actual basal melting retains water separately from recomputed runoff", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  map.IceThickness.set(0, 3);
  expect(meltIce(map, 0, 8, "test", true)).toBe(3);
  expect(map.ExternalMeltwater.get(0)).toBe(3000);
  map.GlacialMeltwater.set(0, 0);
  expect(map.ExternalMeltwater.get(0)).toBe(3000);
  expect(meltIce(map, 0, 8, "test", true)).toBe(0);
});
