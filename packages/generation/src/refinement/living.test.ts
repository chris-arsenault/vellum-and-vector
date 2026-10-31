import { expect, it } from "vitest";
import { createGrid, gridPosition, point, spatial, surfaceCode, biomeCode } from "@atlas/domain";
import { regionalEnvironment } from "./refinementFixture";
import { extractRegionalHabitats, refineLivingCover, refineLocalConditions } from "./living";
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
  refineLocalConditions(state);
  expect(Math.max(...g.channels.runoff)).toBeLessThan(0.003);
  refineLivingCover(state);
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
  g.channels.riverOrder.set(stream, 1);
  refineLivingCover(state);
  expect(g.channels.naturalSurface.get(stream)).toBe(surfaceCode("Desert"));
  expect(g.channels.naturalSurface.get(stream - 1)).toBe(surfaceCode("Desert"));
  expect(g.channels.riverOrder.get(stream)).toBe(1);
  expect(g.channels.water.get(stream)).toBe(0);
});

it("develops sub-parent habitat patches and responds to a local soil perturbation", () => {
  const normal = regionalEnvironment(),
    thin = regionalEnvironment(),
    g = normal.state.surface,
    h = thin.state.surface;
  for (let i = 0; i < h.active.length; i++)
    if (gridPosition(h, i).x > 20000) h.channels.soilDepth.set(i, 0.05);
  g.channels.finalSurface.fill(999);
  h.channels.finalSurface.fill(999);
  refineLivingCover(normal.state);
  refineLivingCover(thin.state);
  const local = Array.from(g.channels.treeCover).filter(
    (_, i) => gridPosition(g, i).x < 5000 && gridPosition(g, i).y < 5000
  );
  expect(Math.max(...local) - Math.min(...local)).toBeGreaterThan(0.05);
  expect(Array.from(h.channels.finalSurface)).not.toEqual(Array.from(g.channels.finalSurface));
  expect(Array.from(g.channels.finalSurface)).not.toContain(999);
  let changed = 0;
  for (let i = 0; i < g.active.length; i++) {
    if (gridPosition(g, i).x <= 20000)
      expect(h.channels.treeCover.get(i)).toBe(g.channels.treeCover.get(i));
    else if (h.channels.treeCover.get(i) < g.channels.treeCover.get(i)) changed++;
  }
  expect(changed).toBeGreaterThan(0);
  expect(Array.from(normal.grid.channels.treeCover).every((v) => v === 0.4)).toBe(true);
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
  extractRegionalHabitats(f.state);
  const forest = Object.values(f.state.domain.world.features).find(
    (feature) => feature.kind === "forest"
  )!;
  expect(forest).toBeDefined();
  expect(spatial.covers(forest.geometry, point({ x: 10000, y: 10000, z: 0 }))).toBe(true);
  expect(spatial.covers(forest.geometry, point({ x: 30000, y: 10000, z: 0 }))).toBe(false);
});

it("keeps isolated sub-mesh habitat as field coverage beside a realized forest", () => {
  const { state } = regionalEnvironment(),
    g = state.surface,
    isolated = Math.floor(g.height / 2) * g.width + g.width - 3;
  g.channels.naturalSurface.fill(surfaceCode("Grassland"));
  for (let i = 0; i < g.active.length; i++)
    if (gridPosition(g, i).x < 10000) g.channels.naturalSurface.set(i, surfaceCode("Woodland"));
  g.channels.naturalSurface.set(isolated, surfaceCode("Woodland"));
  const before = Array.from(g.channels.naturalSurface);
  extractRegionalHabitats(state);
  const forest = Object.values(state.domain.world.features).find((f) => f.kind === "forest")!;
  expect(spatial.covers(forest.geometry, point({ x: 5000, y: 10000, z: 0 }))).toBe(true);
  expect(spatial.covers(forest.geometry, point(gridPosition(g, isolated)))).toBe(false);
  expect(Array.from(g.channels.naturalSurface)).toEqual(before);
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
  extractRegionalHabitats(state);
  const forest = Object.values(state.domain.world.features).find((f) => f.kind === "forest")!;
  expect(spatial.covers(forest.geometry, point(isolated))).toBe(false);
  expect(spatial.covers(forest.geometry, point(clearing))).toBe(true);
  expect(spatial.covers(forest.geometry, point(lake))).toBe(false);
  expect(Array.from(cover)).toEqual(before);
});
