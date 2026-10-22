import { expect, it } from "vitest";
import { createGrid, putChannel, fieldInterpolator, rectangle, gridSchema } from "@atlas/domain";
import { numericTileSampler, tileInterior } from "./numericTiles";
import { terrainTile } from "./terrainTile";
import type { Raster } from "./types";

it("shares physical water stages and source terrain across coarse publication and tile pixels", () => {
  const field = createGrid(
    "shared-water",
    {
      worldId: "world",
      areaId: "area",
      spaceId: "surface",
      crsId: "metres",
      footprint: rectangle([0, 0, 100, 100]),
      time: "present",
      revision: 1,
      resolution: 50,
    },
    3,
    3
  );
  for (const [name, unit] of [
    ["elevation", "metre"],
    ["water", "category"],
    ["waterDepth", "metre"],
    ["waterLevel", "metre"],
    ["seaLevel", "metre"],
  ])
    putChannel(field, name, unit, new Float64Array(9));
  const x = Float64Array.from({ length: 25 }, (_, i) => (i % 5) * 25);
  const y = Float64Array.from({ length: 25 }, (_, i) => Math.floor(i / 5) * 25);
  const elevation = Float64Array.from(x, (value) => value - 50);
  field.ocean = rectangle([0, 0, 50, 100]);
  field.reconstruction = {
    support: { x, y, origin: [0, 0], spacing: 25 },
    channels: { elevation },
    water: { elevation, bodyIds: new Float64Array(25).fill(4), seaLevel: 0, lakes: [] },
  };
  const copy = gridSchema.parse(structuredClone(field));
  const raster: Raster = {
    id: copy.id,
    areaId: "area",
    channel: "elevation",
    field: copy,
    water: copy,
    footprint: copy.scope.footprint,
    bounds: copy.bounds,
  };
  const tile = numericTileSampler(raster),
    wet = fieldInterpolator(copy, "water");
  const depth = fieldInterpolator(copy, "waterDepth");
  for (const px of [23.7, 49.2, 50.8, 76.3]) {
    const p = { x: px, y: 43.1, z: 0 };
    const pixel = tile([px - 0.5, p.y - 0.5, px + 0.5, p.y + 0.5], 1);
    expect(pixel[0]).toBeCloseTo(px - 50, 5);
    expect(pixel[3]).toBe(wet(p));
    expect(depth(p)).toBeCloseTo(Math.max(0, 50 - px), 8);
  }
  const step = 50 / 256;
  const left = tileInterior(terrainTile(tile([-step, -step, 50 + step, 50 + step], 258), 258), 258);
  const right = tileInterior(
    terrainTile(tile([50 - step, -step, 100 + step, 50 + step], 258), 258),
    258
  );
  const a = (128 * 256 + 255) * 8,
    b = 128 * 256 * 8;
  expect(left[a]).toBeCloseTo(-step / 2, 6);
  expect(right[b]).toBeCloseTo(step / 2, 6);
  for (const [values, i] of [
    [left, a],
    [right, b],
  ] as const) {
    expect(values[i + 1]).toBe(1);
    expect(values[i + 6]).toBeCloseTo(1, 6);
    expect(values[i + 7]).toBeCloseTo(0, 6);
  }
});

it("keeps unlisted physical lakes when another lake has an explicit vector", () => {
  const field = createGrid(
    "mixed-lakes",
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
  putChannel(field, "elevation", "metre", new Float64Array(25).fill(100));
  const lakes = [rectangle([10, 10, 40, 40]), rectangle([60, 60, 90, 90])];
  field.reconstruction = {
    support: {
      x: Float64Array.from({ length: 25 }, (_, i) => (i % 5) * 25),
      y: Float64Array.from({ length: 25 }, (_, i) => Math.floor(i / 5) * 25),
      origin: [0, 0],
      spacing: 25,
    },
    channels: { elevation: field.channels.elevation },
    water: {
      elevation: field.channels.elevation,
      bodyIds: new Float64Array(25),
      seaLevel: 0,
      lakes: lakes.map((footprint, i) => ({ id: i + 1, footprint, level: 200 })),
    },
  };
  const raster: Raster = {
    id: "terrain",
    areaId: "area",
    field,
    channel: "elevation",
    footprint: field.scope.footprint,
    bounds: field.bounds,
    lakes: [{ geometry: lakes[0], level: 200 }],
  };
  const tile = numericTileSampler(raster);
  for (const x of [25, 75]) expect(tile([x - 0.5, x - 0.5, x + 0.5, x + 0.5], 1)[3]).toBe(2);
});
