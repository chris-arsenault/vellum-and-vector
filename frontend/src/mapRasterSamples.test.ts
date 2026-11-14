import { expect, it } from "vitest";
import { rasterSample, type RasterSamples } from "./mapRasterSamples";

const samples: RasterSamples = {
  bounds: [0, 0, 20, 20],
  width: 2,
  height: 2,
  bands: ["height", "kind"],
  values: [new Float32Array([10, 20, 30, 40]), new Float32Array([1, 3, 3, 1])],
};
it("places north-first GIS pixels at their centres and interpolates continuous values", () => {
  expect(rasterSample(samples, "height", 5, 15)).toBe(10);
  expect(rasterSample(samples, "height", 5, 5)).toBe(30);
  expect(rasterSample(samples, "height", 10, 10)).toBe(25);
  expect(rasterSample(samples, "height", 20, 0)).toBe(40);
});
it("keeps class codes discrete and rejects an absent map band", () => {
  expect(rasterSample(samples, "kind", 10, 10, true)).toBe(1);
  expect(rasterSample(samples, "kind", 5, 5, true)).toBe(3);
  expect(() => rasterSample(samples, "absent", 5, 5)).toThrow("missing absent");
});
