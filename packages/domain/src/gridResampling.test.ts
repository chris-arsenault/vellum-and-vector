import { requireChannel } from "./grids";
import { expect, it } from "vitest";
import {
  createGrid,
  gridPosition,
  gridSampler,
  putChannel,
  sample,
  type GridSurface,
} from "./grids";
import { point, rectangle, spatial } from "./spatial";
import { resample, resampleChannels } from "./gridResampling";
import { materializeField } from "./fieldComposition";
import { generateBand } from "./lattice/bandValues";
import { gridSchema } from "./gridSchema";

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
it("resamples canonical samples without changing their encoding or storage type", () => {
  const parent = createGrid("parent", scope, 5, 5),
    child = createGrid("child", { ...scope, footprint: rectangle([0, 0, 2, 2]) }, 3, 3);
  putChannel(
    parent,
    "Temperature",
    "native-temperature",
    generateBand(parent.coverage, "int32", "temperature", () => 450)
  );
  putChannel(
    parent,
    "Rainfall",
    "millimetre/year",
    generateBand(parent.coverage, "float32", "rainfall", () => 1200)
  );
  expect(gridSchema.safeParse(parent).success).toBe(true);
  resampleChannels(parent, child);
  expect(requireChannel(child, "Temperature").type).toBe("int32");
  expect(requireChannel(child, "Temperature").get(0)).toBe(450);
  expect(child.units.Temperature).toBe("native-temperature");
  expect(requireChannel(child, "Rainfall").type).toBe("float32");
  expect(requireChannel(child, "Rainfall").get(0)).toBe(1200);
});
it("retains scalar resampling across concave coverage, categorical channels and nested overlapping patches", () => {
  const source: GridSurface<string> = createGrid<string>("parent", scope, 5, 5);
  const constant = (grid: GridSurface<string>, value: number) =>
    generateBand(grid.coverage, "float64", "elevation", () => value);
  putChannel(
    source,
    "elevation",
    "metre",
    generateBand(source.coverage, "float64", "e", (i) => i * 3)
  );
  putChannel(
    source,
    "province",
    "category",
    generateBand(source.coverage, "float64", "p", (i) => i % 4)
  );
  const patch: GridSurface<string> = createGrid<string>(
    "patch",
    { ...scope, footprint: rectangle([0, 0, 3, 3]) },
    3,
    3
  );
  putChannel(patch, "elevation", "metre", constant(patch, 50));
  const nested = createGrid<string>(
    "nested",
    { ...scope, footprint: rectangle([1, 1, 2, 2]) },
    2,
    2
  );
  putChannel(nested, "elevation", "metre", constant(nested, 90));
  patch.overlays = [{ grid: nested, channels: ["elevation"] }];
  const latest = createGrid<string>(
    "latest",
    { ...scope, footprint: rectangle([0, 0, 2, 2]) },
    2,
    2
  );
  putChannel(latest, "elevation", "metre", constant(latest, 70));
  source.overlays = [
    { grid: patch, channels: ["elevation"] },
    { grid: latest, channels: ["elevation"] },
  ];
  const expected = createGrid<string>("expected", scope, 17, 17),
    actual = createGrid<string>("expected", scope, 17, 17);
  for (const channel of Object.keys(source.channels))
    resample(source, expected, channel, source.units[channel] === "category");
  resampleChannels(source, actual);
  const values = (grid: GridSurface<string>) =>
    Object.fromEntries(
      Object.keys(grid.channels).map((k) => [k, Array.from(requireChannel(grid, k))])
    );
  expect(values(actual)).toEqual(values(expected));
  expect(actual.units).toEqual(expected.units);
  checkMaterialization(source);
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
function checkMaterialization(source: GridSurface<string>) {
  const original = Object.fromEntries(
      Object.keys(source.channels).map((k) => [k, Array.from(requireChannel(source, k))])
    ),
    overlays = source.overlays,
    actual = materializeField(source);
  for (const name of Object.keys(actual.channels)) {
    const values = requireChannel(actual, name);
    for (let i = 0; i < values.length; i++) {
      const position = gridPosition(source, i);
      const expected = spatial.covers(source.scope.footprint, point(position))
        ? sample(source, name, position)
        : requireChannel(source, name).get(i);
      expect(
        spatial.covers(actual.scope.footprint, point(position))
          ? sample(actual, name, position)
          : values.get(i)
      ).toBe(expected);
    }
  }
  for (const [name, values] of Object.entries(original))
    expect(Array.from(requireChannel(source, name))).toEqual(values);
  expect(source.overlays).toBe(overlays);
  const layers = (grid: GridSurface<string>) =>
    grid.overlays?.map(({ grid: overlay, channels }) => ({
      id: overlay.id,
      channels,
      values: channels.map((name) => Array.from(requireChannel(overlay, name))),
    }));
  expect(layers(actual)).toEqual(layers(source));
}
