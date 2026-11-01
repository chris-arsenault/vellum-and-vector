import { expect, it } from "vitest";
import { createGrid, gridPosition, point, spatial, surfaceCode, biomeCode } from "@atlas/domain";
import { respondClimate } from "./climate";
import { extractHabitats } from "./extraction/habitats";
import { regionalEnvironment } from "./fixture";
import { respondCover } from "./living";
import { channel } from "./state";

it("keeps an arid interior dry despite a humid atmosphere and a large dry catchment", () => {
  const { state } = regionalEnvironment(),
    g = state.surface;
  g.channels.moisture.fill(0.95);
  g.channels.rainfall.fill(0.06);
  g.channels.runoff.fill(0.002);
  g.channels.treeCover.fill(0);
  g.channels.catchmentArea.fill(1e11);
  channel(state, "soilWater", "metre", 0.005);
  channel(state, "floodplain", "ratio");
  // A supplied wet coastal margin is distinct from the interior at the same temperature.
  for (let i = 0; i < g.active.length; i++)
    if (gridPosition(g, i).y < 3000) {
      g.channels.soilWater.set(i, 0.3);
      g.channels.floodplain.set(i, 1);
    }
  respondClimate(state);
  expect(Math.max(...g.channels.runoff)).toBeLessThan(0.003);
  respondCover(state);
  for (let i = 0; i < g.active.length; i++) {
    if (gridPosition(g, i).y < 3000) {
      expect(g.channels.wetlandCover.get(i)).toBeGreaterThan(0.5);
      expect(g.channels.biome.get(i)).toBe(biomeCode("Marsh"));
    } else {
      expect(g.channels.wetlandCover.get(i)).toBe(0);
      expect(g.channels.treeCover.get(i)).toBeLessThan(0.05);
      expect(g.channels.biome.get(i)).toBe(biomeCode("Desert"));
    }
  }
});

it("keeps a small stream's surrounding land cover instead of painting a cell-wide wet valley", () => {
  const { state } = regionalEnvironment(),
    g = state.surface,
    stream = g.width * 4 + 6;
  g.channels.treeCover.fill(0);
  g.channels.rainfall.fill(0.06);
  g.channels.naturalSurface.fill(surfaceCode("Desert"));
  channel(state, "biome", "category", biomeCode("Desert"));
  g.channels.riverOrder.set(stream, 1);
  respondCover(state);
  expect(g.channels.naturalSurface.get(stream)).toBe(surfaceCode("Desert"));
  expect(g.channels.naturalSurface.get(stream - 1)).toBe(surfaceCode("Desert"));
  expect(g.channels.water.get(stream)).toBe(0);
});

it("gives the same cover to the same conditions, thins it on a soil perturbation, and evaluates the same way twice", () => {
  const normal = regionalEnvironment(),
    thin = regionalEnvironment(),
    g = normal.state.surface,
    h = thin.state.surface;
  for (let i = 0; i < h.active.length; i++)
    if (gridPosition(h, i).x > 20000) h.channels.soilDepth.set(i, 0.05);
  g.channels.finalSurface.fill(999);
  h.channels.finalSurface.fill(999);
  respondCover(normal.state);
  respondCover(thin.state);
  // No sub-parent patch noise: the same conditions give the same cover everywhere.
  expect(new Set(g.channels.treeCover).size).toBe(1);
  expect(new Set(g.channels.naturalSurface).size).toBe(1);
  expect(Array.from(g.channels.finalSurface)).not.toContain(999);
  let changed = 0;
  for (let i = 0; i < g.active.length; i++) {
    if (gridPosition(g, i).x <= 20000)
      expect(h.channels.treeCover.get(i)).toBe(g.channels.treeCover.get(i));
    else if (h.channels.treeCover.get(i) < g.channels.treeCover.get(i)) changed++;
  }
  expect(changed).toBeGreaterThan(0);
  const once = Array.from(g.channels.treeCover);
  respondCover(normal.state);
  expect(Array.from(g.channels.treeCover)).toEqual(once);
});

it("opens captured forest on steep thin ground it cannot carry and passes the tree line on cold new relief", () => {
  const { state } = regionalEnvironment(),
    g = state.surface;
  channel(state, "biome", "category", biomeCode("Temperate forest"));
  g.channels.naturalSurface.fill(surfaceCode("Temperate forest"));
  g.channels.treeCover.fill(0.6);
  for (let i = 0; i < g.active.length; i++) {
    const p = gridPosition(g, i);
    if (p.x < 10000) g.channels.temperature.set(i, -1);
    if (p.x > 30000) {
      g.channels.soilDepth.set(i, 0.03);
      g.channels.slope.set(i, 0.25);
    }
  }
  respondCover(state);
  const at = (x: number) =>
    g.channels.biome.get(
      Math.floor(g.height / 2) * g.width + Math.round((x / 40000) * (g.width - 1))
    );
  expect(at(5000)).toBe(biomeCode("Tundra"));
  expect(at(20000)).toBe(biomeCode("Temperate forest"));
  expect([biomeCode("Woodland"), biomeCode("Grassland")]).toContain(at(37000));
});

it("draws habitat outlines from the native surface classes used by the raster", () => {
  const f = regionalEnvironment(),
    g = f.state.surface;
  g.channels.treeCover.fill(0.4);
  channel(f.state, "wetlandCover", "ratio");
  channel(f.state, "grassCover", "ratio", 0.3);
  for (let i = 0; i < g.active.length; i++)
    g.channels.naturalSurface.set(
      i,
      surfaceCode(gridPosition(g, i).x < 20000 ? "Woodland" : "Grassland")
    );
  extractHabitats(f.state);
  const forest = Object.values(f.state.domain.world.features).find(
    (feature) => feature.kind === "forest"
  )!;
  expect(forest).toBeDefined();
  expect(spatial.covers(forest.geometry, point({ x: 10000, y: 10000, z: 0 }))).toBe(true);
  expect(spatial.covers(forest.geometry, point({ x: 30000, y: 10000, z: 0 }))).toBe(false);
});

it("uses named-biome extent and gap rules without removing fine cover or physical lakes", () => {
  const { state } = regionalEnvironment();
  state.surface = createGrid("supplied-habitats", state.surface.scope, 81, 41);
  const g = state.surface,
    cover = channel(state, "naturalSurface", "category", surfaceCode("Grassland")),
    water = channel(state, "water", "category"),
    patch = (x: number, y: number, code: number) => {
      for (let row = y; row < y + 2; row++)
        for (let col = x; col < x + 2; col++) cover.set(row * g.width + col, code);
      return gridPosition(g, y * g.width + x);
    };
  for (let i = 0; i < g.active.length; i++)
    if (gridPosition(g, i).x < 10000) cover.set(i, surfaceCode("Woodland"));
  const isolated = patch(65, 20, surfaceCode("Woodland")),
    clearing = patch(8, 20, surfaceCode("Grassland")),
    lake = patch(8, 30, surfaceCode("Lake"));
  for (let row = 30; row < 32; row++)
    for (let col = 8; col < 10; col++) water.set(row * g.width + col, 2);
  const before = Array.from(cover);
  extractHabitats(state);
  const forest = Object.values(state.domain.world.features).find((f) => f.kind === "forest")!;
  expect(spatial.covers(forest.geometry, point(isolated))).toBe(false);
  expect(spatial.covers(forest.geometry, point(clearing))).toBe(true);
  expect(spatial.covers(forest.geometry, point(lake))).toBe(false);
  expect(Array.from(cover)).toEqual(before);
});
