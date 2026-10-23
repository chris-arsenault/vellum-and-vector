import { expect, it } from "vitest";
import { rasterPresentationSchema } from "./viewSchemas";

it("accepts every base map a session view can be saved with", () => {
  for (const base of ["surface", "topographic", "relief"])
    expect(
      rasterPresentationSchema.parse({
        base,
        sunAzimuth: 315,
        sunElevation: 45,
        exaggeration: 1,
        contourInterval: 100,
        fields: [],
      }).base
    ).toBe(base);
  expect(() => rasterPresentationSchema.parse({ base: "satellite", fields: [] })).toThrow();
});
