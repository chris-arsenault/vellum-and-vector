import { expect, it } from "vitest";
import { rasterGeographyKey, rasterIdentity } from "./rasterIdentity";
import type { ResourceRaster } from "./types";
import { quantizeWindow } from "./useScene";

function raster(windows: [number, number, number, number][]): ResourceRaster {
  const scope = { worldId: "w", spaceId: "s", areaId: "a" };
  return {
    id: "field",
    areaId: "a",
    channel: "elevation",
    footprint: { type: "Polygon", coordinates: [] },
    bounds: [0, 0, 1000, 1000],
    field: {
      resourceId: "r1",
      scope: {
        ...scope,
        crsId: "m",
        revision: 1,
        footprint: { type: "Polygon", coordinates: [] },
        time: "present",
        resolution: null,
      },
      bounds: [0, 0, 1000, 1000],
      units: {},
      quantities: {},
      channels: {},
      patches: [],
    },
    geography: { scope, areaId: "a", geographyId: "g", windows, tolerance: 4, revision: 1 },
  } as ResourceRaster;
}

it("keeps a raster's resource identity across viewport changes", () => {
  const before = raster([[0, 0, 100, 100]]),
    after = raster([[500, 500, 600, 600]]);
  expect(rasterIdentity(before)).toBe(rasterIdentity(after));
  expect(rasterGeographyKey(before.geography)).not.toBe(rasterGeographyKey(after.geography));
});

it("snaps the raster window outward to a power-of-two cell", () => {
  expect(quantizeWindow([130, 70, 330, 220])).toEqual([0, 0, 512, 256]);
  expect(quantizeWindow([140, 75, 340, 225])).toEqual([0, 0, 512, 256]);
  expect(quantizeWindow([600, 75, 800, 225])).toEqual([512, 0, 1024, 256]);
});
