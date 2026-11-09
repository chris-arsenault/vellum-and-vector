import { expect, it, vi } from "vitest";
import { putChannel, residentBand, spatial } from "@atlas/domain";
import { landscape } from "./mapFixtures";
import { SocietyNeighbors } from "./societySpatial";
import { SocietySpread } from "./societyTraversal";

it("shares checked geometry between spreads while reading current terrain and water", () => {
  const state = landscape(),
    grid = state.surface;
  grid.channels.elevation.fill(100);
  for (const name of ["water", "riverOrder"])
    putChannel(grid, name, "ratio", residentBand("float64", new Float64Array(grid.active.length)));
  const coverage = spatial.geometryCoverage.bind(spatial),
    queries = vi.fn(coverage(grid.scope.footprint)),
    prepared = vi.spyOn(spatial, "geometryCoverage").mockReturnValue(queries);
  try {
    const adjacent = new SocietyNeighbors(grid, false),
      distance = () => {
        const spread = new SocietySpread(state, false, Infinity, adjacent);
        try {
          spread.seed(0, 0);
          spread.run();
          return spread.distances.get(1);
        } finally {
          grid.coverage.release(spread.owner);
          grid.coverage.release(spread.distances);
        }
      };
    expect(distance()).toBe(1000);
    const calls = queries.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    grid.channels.elevation.set(1, 200);
    expect(distance()).toBe(4000);
    grid.channels.riverOrder.set(0, 1);
    grid.channels.riverOrder.set(1, 1);
    expect(distance()).toBe(500);
    grid.channels.water.set(1, 1);
    expect(distance()).toBe(Infinity);
    expect(queries.mock.calls.length).toBe(calls);
    expect(prepared).toHaveBeenCalledOnce();
  } finally {
    prepared.mockRestore();
  }
});
