import { expect, it, vi } from "vitest";

// World-depth runs on a supplied country: longer than the suite's default per-test budget.
vi.setConfig({ testTimeout: 120_000 });
import { canonryMagicPresets, canonryConfluencePresets } from "@atlas/domain";
import { regionalFixture, runSchedule } from "./fixture";
import { isContent } from "./lattice";

const mountain = (x: number, y: number) => 100 + x / 25 + Math.abs(y - 20000) / 12;

it("runs the three rounds, the refresh and the extraction on a supplied mountain country", () => {
  const f = regionalFixture(mountain, 40000, 2),
    state = f.state;
  state.domain.world.magicSystems = canonryMagicPresets();
  state.domain.world.confluences = canonryConfluencePresets();
  runSchedule(state);
  const map = state.physical.map,
    features = Object.values(state.domain.world.features);
  expect(state.regional.round).toBe(4);
  let rivers = 0,
    finite = true;
  for (let i = 0; i < map.mesh.count; i++) {
    if (!isContent(map.mesh, i)) continue;
    if (map.RiverOrders.get(i) > 0) rivers++;
    finite &&= Number.isFinite(map.Elevation.get(i));
  }
  expect(rivers).toBeGreaterThan(0);
  expect(finite).toBe(true);
  expect(features.some((feature) => feature.kind === "river")).toBe(true);
  // The surface the frontend renders carries the projected field.
  expect(state.surface.channels.elevation).toBeDefined();
  expect(state.surface.channels.riverOrder).toBeDefined();
  expect(Array.from(f.grid.channels.elevation)).toEqual(
    Array.from(f.source.numerical.captured.channels.elevation)
  );
});
