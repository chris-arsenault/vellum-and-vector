import { expect, it } from "vitest";
import { createGrid, gridPosition, putChannel, rectangle, spatial } from "@atlas/domain";
import { landscape } from "./mapFixtures";
import { findRoute } from "./mapRouting";

it("routes a road around water within its exact mapped footprint", () => {
  const state = landscape();
  const grid = createGrid("routing", state.domain.scope, 192, 192);
  putChannel(
    grid,
    "elevation",
    "metre",
    Float64Array.from(grid.active, (_, i) => {
      const x = i % grid.width,
        y = Math.floor(i / grid.width);
      return x > 85 && x < 105 && y < 150 ? -10 : 100;
    })
  );
  const start = gridPosition(grid, 20 * grid.width + 20),
    end = gridPosition(grid, 20 * grid.width + 170);
  const began = performance.now();
  const route = findRoute(grid, start, end, "road");
  console.log(`Coastal road (192 × 192 samples): ${Math.round(performance.now() - began)} ms`);
  expect(route[0]).toEqual(start);
  expect(route.at(-1)).toEqual(end);
  expect(route.some((p) => p.y > 700)).toBe(true);
  const geometry = { type: "LineString" as const, coordinates: route.map((p) => [p.x, p.y]) };
  expect(spatial.covers(grid.scope.footprint, geometry)).toBe(true);
  expect(spatial.intersects(rectangle([1800, 0, 2150, 700]), geometry)).toBe(false);
});

it("keeps roads out of footprint holes even when samples on either side are active", () => {
  const state = landscape();
  state.domain.scope.footprint = {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [4000, 0],
        [4000, 1000],
        [0, 1000],
        [0, 0],
      ],
      [
        [1800, 250],
        [2200, 250],
        [2200, 750],
        [1800, 750],
        [1800, 250],
      ],
    ],
  };
  const grid = createGrid("hole", state.domain.scope, 30, 12);
  putChannel(grid, "elevation", "metre", new Float64Array(grid.active.length).fill(100));
  const route = findRoute(grid, { x: 1000, y: 500, z: 0 }, { x: 3000, y: 500, z: 0 }, "road");
  expect(route.length).toBeGreaterThan(2);
  expect(
    spatial.covers(grid.scope.footprint, {
      type: "LineString",
      coordinates: route.map((p) => [p.x, p.y]),
    })
  ).toBe(true);
});

it("takes a ridge through its saddle rather than over its crest", () => {
  const state = landscape();
  const grid = createGrid("ridge", state.domain.scope, 60, 60);
  // A north–south ridge across the middle, with a low saddle near the southern end.
  putChannel(
    grid,
    "elevation",
    "metre",
    Float64Array.from(grid.active, (_, i) => {
      const x = i % grid.width,
        y = Math.floor(i / grid.width);
      if (x < 27 || x > 33) return 100;
      return y >= 48 && y <= 51 ? 140 : 900;
    })
  );
  const start = gridPosition(grid, 10 * grid.width + 5),
    end = gridPosition(grid, 10 * grid.width + 55);
  const route = findRoute(grid, start, end, "road");
  const crossing = route.find((p) => Math.abs(p.x - gridPosition(grid, 30).x) < 1e-6);
  expect(crossing).toBeDefined();
  expect(crossing!.y).toBeGreaterThan(gridPosition(grid, 47 * grid.width).y);
});

it("follows a river bank instead of cutting across the open interfluve", () => {
  const state = landscape();
  const grid = createGrid("river", state.domain.scope, 60, 20);
  putChannel(grid, "elevation", "metre", new Float64Array(grid.active.length).fill(100));
  // A river runs west–east along row 15; the straight line between the towns is row 10.
  putChannel(
    grid,
    "riverOrder",
    "ratio",
    Float64Array.from(grid.active, (_, i) => (Math.floor(i / grid.width) === 15 ? 2 : 0))
  );
  const start = gridPosition(grid, 10 * grid.width + 2),
    end = gridPosition(grid, 10 * grid.width + 57);
  const route = findRoute(grid, start, end, "road");
  const riverY = gridPosition(grid, 15 * grid.width).y;
  const onBank = route.filter((p) => Math.abs(p.y - riverY) < 1e-6).length;
  expect(onBank).toBeGreaterThan(route.length / 2);
});
