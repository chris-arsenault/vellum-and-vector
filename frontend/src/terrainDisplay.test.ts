import { expect, it } from "vitest";
import {
  createGrid,
  fieldInterpolator,
  generateBand,
  gridPosition,
  putChannel,
  rectangle,
} from "@atlas/domain";
import { terrainDisplaySampler } from "./terrainDisplay";
import { numericTileSampler, terrainSampleBands } from "./numericTiles";
import { terrainTile } from "./terrainTile";
import type { LoadedRaster as Raster } from "./types";

function fixture(at: (x: number, y: number) => number): Raster {
  const grid = createGrid(
    "terrain",
    {
      worldId: "world",
      areaId: "area",
      spaceId: "surface",
      crsId: "metres",
      footprint: rectangle([0, 0, 1000, 1000]),
      time: "present",
      revision: 1,
      resolution: null,
    },
    9,
    9
  );
  putChannel(
    grid,
    "elevation",
    "metre",
    generateBand(grid.coverage, "float64", "elevation", (i) => {
      const p = gridPosition(grid, i);
      return at(p.x, p.y);
    })
  );
  return {
    id: grid.id,
    areaId: "area",
    field: grid,
    channel: "elevation",
    footprint: grid.scope.footprint,
    bounds: grid.bounds,
  };
}

it("retains every height sample, planes and constants including the field edges", () => {
  for (const height of [(x: number, y: number) => 200 + x * 0.3 - y * 0.2, () => 0.1]) {
    const raster = fixture(height),
      display = terrainDisplaySampler(raster.field);
    const before = Array.from(raster.field.channels.elevation);
    for (let x = 0; x <= 1000; x += 25)
      for (let y = 0; y <= 1000; y += 25)
        expect(display({ x, y, z: 0 })).toBeCloseTo(height(x, y), 9);
    expect(Array.from(raster.field.channels.elevation)).toEqual(before);
  }
  const raster = fixture((x, y) => 100 + 300 * Math.sin(x / 200) * Math.cos(y / 150));
  const display = terrainDisplaySampler(raster.field);
  for (let i = 0; i < raster.field.active.length; i++)
    expect(display(gridPosition(raster.field, i))).toBeCloseTo(
      raster.field.channels.elevation.get(i),
      9
    );
});

it("removes lattice slope jumps while retaining bounded ridges and valleys", () => {
  const raster = fixture((x, y) => 1000 + 2000 * Math.exp(-(((x - 480) / 170) ** 2)) + y * 0.1);
  const display = terrainDisplaySampler(raster.field),
    raw = fieldInterpolator(raster.field, "elevation");
  const derivativeJump = (at: typeof raw, x: number) => {
    const p = { x, y: 560, z: 0 },
      h = 0.01;
    return Math.abs((at({ ...p, x: x + h }) - 2 * at(p) + at({ ...p, x: x - h })) / h);
  };
  expect(derivativeJump(raw, 375)).toBeGreaterThan(1);
  expect(derivativeJump(display, 375)).toBeLessThan(0.01);
  const grid = raster.field;
  for (let x = 1; x < 1000; x += 13)
    for (let y = 1; y < 1000; y += 17) {
      const i = Math.min(7, Math.floor(y / 125)) * 9 + Math.min(7, Math.floor(x / 125));
      const corners = [i, i + 1, i + 9, i + 10].map((j) => grid.channels.elevation.get(j));
      const value = display({ x, y, z: 0 });
      expect(value).toBeGreaterThanOrEqual(Math.min(...corners) - 1e-9);
      expect(value).toBeLessThanOrEqual(Math.max(...corners) + 1e-9);
    }
});

it("keeps physical values and water separate from display generalization", () => {
  const raster = fixture((x) => 100 + (x * x) / 1000);
  const raw = fieldInterpolator(raster.field, "elevation");
  raster.lakes = [{ geometry: rectangle([100, 100, 900, 900]), level: 350 }];
  const p = { x: 180, y: 560, z: 0 };
  const tile = numericTileSampler(raster)([p.x - 1, p.y - 1, p.x + 1, p.y + 1], 1);
  expect(tile[0]).toBeCloseTo(raw(p), 4);
  expect(tile[2]).toBeCloseTo(raw(p), 4);
  expect(tile[3]).toBe(2);
  expect(Math.abs(tile[8] - tile[0])).toBeGreaterThan(1);
});

it("retains overlay precedence and falls back beside inactive or nonfinite samples", () => {
  const raster = fixture((x) => (x * x) / 1000),
    patch = fixture(() => 700).field;
  patch.scope.footprint = rectangle([400, 400, 600, 600]);
  raster.field.overlays = [{ grid: patch, channels: ["elevation"] }];
  const display = terrainDisplaySampler(raster.field);
  expect(display({ x: 500, y: 500, z: 0 })).toBe(700);
  expect(display({ x: 399, y: 500, z: 0 })).toBeLessThan(200);
  raster.field.active.set(4 * 9 + 1, 0);
  const point = { x: 270, y: 500, z: 0 },
    raw = fieldInterpolator(raster.field, "elevation");
  expect(display(point)).toBe(raw(point));
  raster.field.active.set(4 * 9 + 1, 1);
  raster.field.channels.elevation.set(4 * 9 + 1, NaN);
  expect(display(point)).toBe(raw(point));
});

it("matches display heights and gradients on independent tile halos", () => {
  const raster = fixture((x, y) => 100 + (x * x) / 1000 + Math.sin(y / 100) * 20);
  const sample = numericTileSampler(raster),
    bands = terrainSampleBands + 2;
  const whole = terrainTile(sample([0, 0, 1000, 1000], 100), 100);
  const tile = terrainTile(sample([490, 490, 1010, 1010], 52), 52);
  for (let row = 2; row < 50; row++) {
    const at = (row * 52 + 1) * bands,
      source = ((row - 1) * 100 + 50) * bands;
    expect(tile.slice(at, at + bands)).toEqual(whole.slice(source, source + bands));
  }
});
