import { expect, it, vi } from "vitest";
import { fieldInterpolator, rectangle, spatial } from "@atlas/domain";
import { createRefinementState } from "./inputs";
import { regionalFixture } from "./refinementFixture";
import { putRefinementFeature, putRefinementNetwork } from "./features";

it("reads the immutable world bounds once when wrapping regional samples", () => {
  const f = regionalFixture((x) => 100 + Math.sin((x / 40000) * Math.PI * 2) * 100);
  f.source.world.reference.boundaryMode = "cylinder";
  const bounds = vi.spyOn(spatial, "bounds");
  try {
    const state = createRefinementState(f.source, f.input);
    expect(
      bounds.mock.calls.filter(([geometry]) => geometry === state.domain.world.reference.domain)
    ).toHaveLength(1);
    expect(state.surface.channels.elevation.get(0)).toBeCloseTo(f.grid.channels.elevation.get(0));
  } finally {
    bounds.mockRestore();
  }
});

it("keeps a seam-crossing regional surface local and samples both sides of its chart", () => {
  const f = regionalFixture((x) => 100 + Math.sin((x / 40000) * Math.PI * 2) * 100);
  f.source.world.reference.boundaryMode = "cylinder";
  f.source.world.areas.area.footprint = spatial.unionAll([
    rectangle([0, 4000, 2000, 12000]),
    rectangle([38000, 4000, 40000, 12000]),
  ])!;
  const state = createRefinementState(f.source, f.input),
    g = state.surface;
  expect(g.bounds[2] - g.bounds[0]).toBeLessThan(12000);
  expect(g.active.length).toBeLessThan(300);
  expect(fieldInterpolator(g, "elevation")({ x: 39000, y: 8000, z: 0 })).toBeLessThan(100);
  expect(fieldInterpolator(g, "elevation")({ x: 1000, y: 8000, z: 0 })).toBeGreaterThan(100);
  expect(spatial.area(g.scope.footprint)).toBeCloseTo(
    (g.bounds[2] - g.bounds[0]) * (g.bounds[3] - g.bounds[1]),
    2
  );
  const coordinates = [
      [39000, 8000],
      [41000, 8000],
    ],
    feature = putRefinementFeature(state, "seam-river", "river", "rivers", {
      type: "LineString",
      coordinates,
    });
  expect(feature.geometry.type).toBe("MultiLineString");
  putRefinementNetwork(state, feature, 2, coordinates);
  const reach = Object.values(state.domain.world.networkReaches!)[0];
  expect(spatial.length(reach.geometry)).toBeCloseTo(2000, 5);
  expect(state.domain.world.networkNodes![reach.start].position.x).toBe(39000);
  expect(state.domain.world.networkNodes![reach.end].position.x).toBe(1000);
});

it("leaves a physical neighborhood around the subject for coastal development", () => {
  const f = regionalFixture();
  f.source.world.areas.area.footprint = rectangle([10000, 5000, 30000, 15000]);
  const state = createRefinementState(f.source, f.input);
  expect(state.surface.bounds[0]).toBeLessThan(10000);
  expect(state.surface.bounds[2]).toBeGreaterThan(30000);
  expect(state.domain.world.areas.area.footprint).toEqual(state.surface.scope.footprint);
  expect(f.source.world.areas.area.footprint).toEqual(rectangle([10000, 5000, 30000, 15000]));
});
