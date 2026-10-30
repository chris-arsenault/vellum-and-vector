import { expect, it } from "vitest";
import { gridPosition, point, spatial, surfaceCode, biomeCode } from "@atlas/domain";
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
