import { expect, it } from "vitest";
import {
  createGrid,
  gridPosition,
  gridSampler,
  putChannel,
  resample,
  sample,
  type GridSurface,
} from "./grids";
import { point, rectangle, spatial } from "./spatial";
import { resampleChannels } from "./gridResampling";

it("retains scalar resampling across concave coverage, categorical channels and nested overlapping patches", () => {
  const footprint = {
    type: "Polygon" as const,
    coordinates: [
      [
        [0, 0],
        [8, 0],
        [8, 3],
        [3, 3],
        [3, 8],
        [0, 8],
        [0, 0],
      ],
    ],
  };
  const scope = {
    worldId: "world",
    areaId: "area",
    spaceId: "surface",
    crsId: "metres",
    footprint,
    revision: 1,
    time: "present",
    resolution: null,
  };
  const source: GridSurface = createGrid("parent", scope, 5, 5);
  putChannel(
    source,
    "elevation",
    "metre",
    Float64Array.from(source.active, (_, i) => i * 3)
  );
  putChannel(
    source,
    "province",
    "category",
    Float64Array.from(source.active, (_, i) => i % 4)
  );
  const patch: GridSurface = createGrid(
    "patch",
    { ...scope, footprint: rectangle([0, 0, 3, 3]) },
    3,
    3
  );
  putChannel(patch, "elevation", "metre", new Float64Array(9).fill(50));
  const nested = createGrid("nested", { ...scope, footprint: rectangle([1, 1, 2, 2]) }, 2, 2);
  putChannel(nested, "elevation", "metre", new Float64Array(4).fill(90));
  patch.overlays = [{ grid: nested, channels: ["elevation"] }];
  const latest = createGrid("latest", { ...scope, footprint: rectangle([0, 0, 2, 2]) }, 2, 2);
  putChannel(latest, "elevation", "metre", new Float64Array(4).fill(70));
  source.overlays = [
    { grid: patch, channels: ["elevation"] },
    { grid: latest, channels: ["elevation"] },
  ];
  const expected = createGrid("expected", scope, 17, 17),
    actual = structuredClone(expected);
  for (const channel of Object.keys(source.channels))
    resample(source, expected, channel, source.units[channel] === "category");
  resampleChannels(source, actual);
  expect(actual.channels).toEqual(expected.channels);
  expect(actual.units).toEqual(expected.units);
  for (const channel of Object.keys(source.channels)) {
    const discrete = source.units[channel] === "category",
      valueAt = gridSampler(source, channel, discrete);
    for (let i = 0; i < actual.active.length; i++) {
      const position = gridPosition(actual, i);
      if (spatial.covers(source.scope.footprint, point(position)))
        expect(valueAt(position)).toBe(sample(source, channel, position, discrete));
      else expect(() => valueAt(position)).toThrow("Sample lies outside field coverage.");
    }
  }
});
