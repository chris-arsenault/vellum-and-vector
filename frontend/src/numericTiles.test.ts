import { requireChannel, MapScale, type FieldChannelName } from "@atlas/domain";
import { expect, it } from "vitest";
import {
  copyGrid,
  createGrid,
  createAdaptiveField,
  createAdaptiveTopology,
  fillBand,
  generateBand,
  putChannel,
  rectangle,
  overlayField,
} from "@atlas/domain";
import { numericTileSampler, terrainSampleBands } from "./numericTiles";
import {
  defaultFieldStyle,
  fieldRange,
  legendValue,
  scaledValue,
  rasterCategories,
} from "./rasterPresentation";
import { terrainStyle, overlayStyle } from "./rasterStyles";
import { defaultRasterPresentation } from "./rasterPresentation";
import {
  canonryMagicPresets,
  magicPlacePresentations,
  naturalSurfaceColors,
  surfaceCategories,
  magicSurfaceCode,
  surfaceCode,
} from "@atlas/domain";
import { newCompilationContext, buildExpression } from "ol/expr/gpu.js";
import { ColorType, NumberType, newParsingContext } from "ol/expr/expression.js";
import type { LoadedRaster as Raster } from "./types";

function fixture(channel: FieldChannelName = "Temperature"): Raster {
  const field = createGrid(
    "numeric",
    {
      worldId: "world",
      areaId: "area",
      spaceId: "surface",
      crsId: "metres",
      footprint: rectangle([0, 0, 100, 100]),
      time: "present",
      revision: 1,
      resolution: 25,
    },
    5,
    5
  );
  putChannel(
    field,
    channel,
    channel === "Elevation" ? "native-length" : "native-temperature",
    generateBand(field.coverage, "float64", channel, (i) => (i % 5) - 2)
  );
  return {
    id: field.id,
    areaId: "area",
    field,
    channel,
    footprint: field.scope.footprint,
    bounds: field.bounds,
  };
}

it("reports composed biome categories rather than hidden base or superseded patch values", () => {
  const raster = fixture("BiomeCodes"),
    patch = fixture("BiomeCodes").field;
  raster.field.units.BiomeCodes = "category";
  requireChannel(raster.field, "BiomeCodes").fill(10);
  patch.units.BiomeCodes = "category";
  requireChannel(patch, "BiomeCodes").fill(15);
  overlayField(raster.field, patch);
  expect(rasterCategories([raster])).toEqual([15]);
  expect(numericTileSampler(raster)([49, 49, 51, 51], 1)[0]).toBe(15);
  const restored = copyGrid(patch);
  restored.scope.footprint = rectangle([0, 0, 40, 100]);
  requireChannel(restored, "BiomeCodes").fill(7);
  overlayField(raster.field, restored);
  expect(rasterCategories([raster])).toEqual([7, 15]);
  const child = fixture("BiomeCodes");
  requireChannel(child.field, "BiomeCodes").fill(6);
  child.field.units.BiomeCodes = "category";
  expect(rasterCategories([raster, child])).toEqual([6]);
});
it("retains zero, negative values and their logarithms while masking absent coverage", () => {
  const raster = fixture(),
    sample = numericTileSampler(raster);
  expect([...sample([49, 49, 51, 51], 1)]).toEqual([0, 1, 0]);
  const negative = sample([24, 49, 26, 51], 1);
  expect(negative[0]).toBe(-1);
  expect(negative[1]).toBe(1);
  expect(negative[2]).toBeCloseTo(-Math.log(2));
  expect([...sample([-20, -20, -10, -10], 1)]).toEqual([0, 0, 0]);
  requireChannel(raster.field, "Temperature").fill(NaN);
  expect([...numericTileSampler(raster)([49, 49, 51, 51], 1)]).toEqual([0, 0, 0]);
  requireChannel(raster.field, "Temperature").fill(25);
  raster.field.active.fill(0);
  expect([...numericTileSampler(raster)([49, 49, 51, 51], 1)]).toEqual([0, 0, 0]);
});
it("samples adjacent numerical tiles identically to a combined view", () => {
  const sample = numericTileSampler(fixture());
  const whole = sample([0, 0, 100, 100], 16);
  const tile = sample([50, 50, 100, 100], 8);
  for (let row = 0; row < 8; row++)
    expect(tile.slice(row * 8 * 3, (row + 1) * 8 * 3)).toEqual(
      whole.slice((row * 16 + 8) * 3, (row * 16 + 16) * 3)
    );
});
it("preserves authored patches, physical sea level, lakes and emergent islands", () => {
  const raster = fixture("Elevation");
  requireChannel(raster.field, "Elevation").fill(MapScale.native(100));
  raster.water = {
    ...raster.field,
    channels: {
      EffectiveSeaLevel: generateBand(raster.field.coverage, "float64", "EffectiveSeaLevel", () =>
        MapScale.native(200)
      ),
    },
  };
  raster.lakes = [{ geometry: rectangle([20, 20, 80, 80]), level: 300 }];
  expect([...numericTileSampler(raster)([29, 29, 31, 31], 1)]).toEqual([
    MapScale.native(100),
    1,
    -100,
    2,
    0,
    2,
    -1,
    -1,
    100,
  ]);
  const patch = fixture("Elevation").field;
  patch.scope = { ...patch.scope, footprint: rectangle([45, 45, 55, 55]) };
  requireChannel(patch, "Elevation").fill(MapScale.native(400));
  raster.field.overlays = [{ grid: patch, channels: ["Elevation"] }];
  expect([...numericTileSampler(raster)([49, 49, 51, 51], 1)]).toEqual([
    MapScale.native(400),
    1,
    200,
    0,
    0,
    2,
    -1,
    -1,
    400,
  ]);
});
it("carries the surface class as a discrete terrain band and marks its absence", () => {
  const raster = fixture("Elevation");
  requireChannel(raster.field, "Elevation").fill(MapScale.native(100));
  expect(numericTileSampler(raster)([49, 49, 51, 51], 1)[6]).toBe(-1);
  raster.surface = fixture("finalSurface").field;
  raster.surface.units.finalSurface = "category";
  fillBand(requireChannel(raster.surface, "finalSurface"), (i) => (i % 5 < 2 ? 3 : 102));
  const sample = numericTileSampler(raster)([0, 0, 100, 100], 32);
  const classes = new Set<number>();
  for (let i = 0; i < sample.length; i += terrainSampleBands)
    if (sample[i + 1]) classes.add(sample[i + 6]);
  expect([...classes].sort((a, b) => a - b)).toEqual([3, 102]);
});
it("carries natural cover beneath a shared magical class", () => {
  const raster = fixture("Elevation");
  requireChannel(raster.field, "Elevation").fill(MapScale.native(100));
  raster.surface = fixture("finalSurface").field;
  const magic = magicSurfaceCode(canonryMagicPresets(), "aurora", "field")!;
  putChannel(
    raster.surface,
    "finalSurface",
    "category",
    generateBand(raster.surface.coverage, "float64", "finalSurface", () => magic),
    "category"
  );
  putChannel(
    raster.surface,
    "naturalSurface",
    "category",
    generateBand(raster.surface.coverage, "float64", "naturalSurface", (i) =>
      surfaceCode(i % 5 < 2 ? "Boreal forest" : "Scree field")
    ),
    "category"
  );
  const sample = numericTileSampler(raster);
  const forest = sample([19, 49, 21, 51], 1),
    rock = sample([79, 49, 81, 51], 1);
  expect(forest[6]).toBe(magic);
  expect(rock[6]).toBe(magic);
  expect(forest[7]).toBe(surfaceCode("Boreal forest"));
  expect(rock[7]).toBe(surfaceCode("Scree field"));
});
it("shares adaptive locations across terrain bands while respecting distinct overlay and ice topologies", () => {
  const raster = fixture("Elevation");
  const field = (id: string, size: number, bounds: [number, number, number, number]) =>
    createAdaptiveField(
      id,
      { ...raster.field.scope, footprint: rectangle(bounds) },
      createAdaptiveTopology(bounds, { maximumSize: size, minimumSize: size })
    );
  raster.field = field("terrain", 25, [0, 0, 100, 100]);
  putChannel(
    raster.field,
    "Elevation",
    "native-length",
    generateBand(raster.field.coverage, "float64", "Elevation", () => MapScale.native(100))
  );
  raster.water = {
    ...raster.field,
    channels: {
      EffectiveSeaLevel: generateBand(raster.field.coverage, "float64", "EffectiveSeaLevel", () =>
        MapScale.native(200)
      ),
    },
  };
  raster.ice = field("IceThickness", 50, [0, 0, 100, 100]);
  putChannel(
    raster.ice,
    "IceThickness",
    "metre",
    generateBand(raster.ice.coverage, "float64", "IceThickness", () => 250)
  );
  const patch = field("patch", 5, [45, 45, 55, 55]);
  putChannel(
    patch,
    "Elevation",
    "native-length",
    generateBand(patch.coverage, "float64", "Elevation", () => MapScale.native(400))
  );
  raster.field.overlays = [{ grid: patch, channels: ["Elevation"] }];
  const sample = numericTileSampler(raster);
  expect([...sample([29, 29, 31, 31], 1)]).toEqual([
    MapScale.native(100),
    1,
    -100,
    1,
    0.25,
    2,
    -1,
    -1,
    100,
  ]);
  expect([...sample([49, 49, 51, 51], 1)]).toEqual([
    MapScale.native(400),
    1,
    200,
    0,
    0.25,
    2,
    -1,
    -1,
    400,
  ]);
  expect([...sample([29, 29, 31, 31], 1)]).toEqual([
    MapScale.native(100),
    1,
    -100,
    1,
    0.25,
    2,
    -1,
    -1,
    100,
  ]);
  patch.active.fill(0);
  expect([...sample([49, 49, 51, 51], 1)]).toEqual(new Array(terrainSampleBands).fill(0));
});
it("shows a cell's stored value where the cell is narrower than the pixels, and the smooth surface where wider", () => {
  const raster = fixture("Elevation"),
    bounds: [number, number, number, number] = [0, 0, 100, 100];
  raster.field = createAdaptiveField(
    "terrain",
    { ...raster.field.scope, footprint: rectangle(bounds) },
    createAdaptiveTopology(bounds, { maximumSize: 10, minimumSize: 10 })
  );
  const cellValue = (i: number) => (i * 37) % 11;
  putChannel(
    raster.field,
    "Elevation",
    "native-length",
    generateBand(raster.field.coverage, "float64", "Elevation", cellValue)
  );
  const sample = numericTileSampler(raster);
  // Ten-metre cells under twenty-metre pixels: each pixel shows its cell's own sample.
  const coarse = sample([0, 0, 100, 100], 5),
    stored = new Set(Array.from({ length: raster.field.active.length }, (_, i) => cellValue(i)));
  for (let pixel = 0; pixel < 25; pixel++)
    expect(stored.has(coarse[pixel * terrainSampleBands])).toBe(true);
  // One-metre pixels inside a cell: the smooth surface varies across it.
  const fine = sample([42, 42, 48, 48], 6),
    heights = new Set(Array.from({ length: 36 }, (_, k) => fine[k * terrainSampleBands]));
  expect(heights.size).toBeGreaterThan(1);
});
it("uses actual data ranges and an invertible signed log legend", () => {
  const raster = fixture();
  requireChannel(raster.field, "Temperature").fill(25);
  const style = defaultFieldStyle("Temperature");
  expect(fieldRange([raster], style)).toEqual([25, 26]);
  expect(legendValue(0.5, [0, 99], "log")).toBeCloseTo(9);
  for (const value of [-99, 0, 99])
    expect(scaledValue(value, "log")).toBeCloseTo(Math.sign(value) * Math.log1p(Math.abs(value)));
});
it("keeps published lake shores when scalar resampling raises the apparent lake floor", () => {
  const raster = fixture("Elevation");
  requireChannel(raster.field, "Elevation").fill(MapScale.native(150));
  raster.lakes = [{ geometry: rectangle([20, 20, 80, 80]), level: 100 }];
  expect(numericTileSampler(raster)([29, 29, 31, 31], 1)[3]).toBe(2);
});
it("compiles terrain and overlay expressions using the real OpenLayers expression parser", () => {
  const surfaces = surfaceCategories(canonryMagicPresets());
  const styles = [
    terrainStyle(defaultRasterPresentation()),
    terrainStyle(defaultRasterPresentation(), surfaces),
    terrainStyle({ ...defaultRasterPresentation(), base: "relief" }, surfaces),
    overlayStyle(defaultFieldStyle("Temperature"), [-10, 30]),
    overlayStyle({ ...defaultFieldStyle("Temperature"), scale: "log" }, [-10, 30]),
    overlayStyle(defaultFieldStyle("BiomeCodes"), [0, 14]),
    overlayStyle(defaultFieldStyle("finalSurface"), [0, 120], surfaces),
  ];
  const surfaced = JSON.stringify(terrainStyle(defaultRasterPresentation(), surfaces).color);
  expect(surfaced).toContain(magicPlacePresentations.spring.color);
  expect(surfaced).not.toContain(naturalSurfaceColors.Ocean);
  expect(JSON.stringify(terrainStyle(defaultRasterPresentation()).color)).not.toContain("match");
  for (const style of styles) {
    expect(
      buildExpression(
        style.color!,
        ColorType,
        newParsingContext(style.variables),
        newCompilationContext(style.variables)
      )
    ).toContain("vec4");
    if (style.brightness)
      expect(
        buildExpression(
          style.brightness,
          NumberType,
          newParsingContext(style.variables),
          newCompilationContext(style.variables)
        )
      ).toContain("clamp");
  }
});
it("samples biome categories without interpolating fictional intermediate biomes", () => {
  const raster = fixture("BiomeCodes");
  raster.field.units.BiomeCodes = "category";
  raster.field.quantities = { BiomeCodes: "category" };
  fillBand(requireChannel(raster.field, "BiomeCodes"), (i) => (i % 5 < 2 ? 5 : 12));
  const sample = numericTileSampler(raster)([0, 0, 100, 100], 32);
  for (let i = 0; i < sample.length; i += 3)
    if (sample[i + 1]) expect([5, 12]).toContain(sample[i]);
});
