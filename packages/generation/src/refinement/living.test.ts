import { expect, it } from "vitest";
import { gridPosition, point, spatial, surfaceCode } from "@atlas/domain";
import { regionalEnvironment } from "./refinementFixture";
import { extractRegionalHabitats, refineLivingCover } from "./living";
import { channel } from "./state";

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
  expect(new Set(g.channels.finalSurface).size).toBeGreaterThan(1);
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
