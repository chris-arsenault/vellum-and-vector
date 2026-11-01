import { expect, it, vi } from "vitest";

// World-depth runs on a supplied country: longer than the suite's default per-test budget.
vi.setConfig({ testTimeout: 120_000 });
import { biomeCode } from "@atlas/domain";
import { respondClimate } from "./climate";
import { regionalEnvironment } from "./fixture";
import { cellAt, isContent } from "./lattice";
import { respondCover } from "./living";
import type { RegionalState } from "./state";

const content = (state: RegionalState) => {
  const mesh = state.physical.map.mesh,
    cells: number[] = [];
  for (let i = 0; i < mesh.count; i++) if (isContent(mesh, i)) cells.push(i);
  return cells;
};
const northing = (state: RegionalState, i: number) =>
  state.physical.map.mesh.y(i) + state.physical.map.mesh.origin[1];
const easting = (state: RegionalState, i: number) =>
  state.physical.map.mesh.x(i) + state.physical.map.mesh.origin[0];

it("keeps an arid interior dry despite a humid atmosphere and a large dry catchment", () => {
  const { state } = regionalEnvironment(),
    map = state.physical.map;
  map.Moisture.fill(950);
  map.Rainfall.fill(60);
  map.Runoff.fill(2);
  map.TreeCover.fill(0);
  map.CatchmentArea.fill(1e11);
  map.SoilWater.fill(0.005);
  map.FloodplainIntensity.fill(0);
  // A supplied wet coastal margin is distinct from the interior at the same temperature.
  for (const i of content(state))
    if (northing(state, i) < 3000) {
      map.SoilWater.set(i, 0.3);
      map.FloodplainIntensity.set(i, 1000);
    }
  state.regional.natural = {};
  respondClimate(state);
  expect(Math.max(...content(state).map((i) => map.Runoff.get(i)))).toBeLessThan(3);
  respondCover(state);
  for (const i of content(state)) {
    if (northing(state, i) < 3000) {
      expect(map.WetlandCover.get(i)).toBeGreaterThan(0.5);
      expect(map.BiomeCodes.get(i)).toBe(biomeCode("Marsh"));
    } else {
      expect(map.WetlandCover.get(i)).toBe(0);
      expect(map.TreeCover.get(i)).toBeLessThan(0.05);
      expect(map.BiomeCodes.get(i)).toBe(biomeCode("Desert"));
    }
  }
});

it("gives the same cover to the same conditions, thins it on a soil perturbation, and evaluates the same way twice", () => {
  const normal = regionalEnvironment(),
    thin = regionalEnvironment(),
    g = normal.state.physical.map,
    h = thin.state.physical.map;
  for (const i of content(thin.state)) if (easting(thin.state, i) > 20000) h.SoilDepth.set(i, 0.05);
  respondCover(normal.state);
  respondCover(thin.state);
  // No sub-parent patch noise: the same conditions give the same cover everywhere.
  expect(new Set(content(normal.state).map((i) => g.TreeCover.get(i))).size).toBe(1);
  let changed = 0;
  for (const i of content(normal.state)) {
    if (easting(normal.state, i) <= 20000) expect(h.TreeCover.get(i)).toBe(g.TreeCover.get(i));
    else if (h.TreeCover.get(i) < g.TreeCover.get(i)) changed++;
  }
  expect(changed).toBeGreaterThan(0);
  const once = content(normal.state).map((i) => g.TreeCover.get(i));
  respondCover(normal.state);
  expect(content(normal.state).map((i) => g.TreeCover.get(i))).toEqual(once);
});

it("opens captured forest on steep thin ground it cannot carry and passes the tree line on cold new relief", () => {
  const { state } = regionalEnvironment(),
    map = state.physical.map;
  map.BiomeCodes.fill(biomeCode("Temperate forest"));
  map.TreeCover.fill(0.6);
  for (const i of content(state)) {
    const x = easting(state, i);
    if (x < 10000) map.Temperature.set(i, 290);
    if (x > 30000) {
      map.SoilDepth.set(i, 0.03);
      map.Slope.set(i, 0.25);
    }
  }
  state.regional.natural = {};
  respondCover(state);
  const at = (x: number) => map.BiomeCodes.get(cellAt(map.mesh, x, 10000));
  expect(at(5000)).toBe(biomeCode("Tundra"));
  expect(at(20000)).toBe(biomeCode("Temperate forest"));
  expect([biomeCode("Woodland"), biomeCode("Grassland")]).toContain(at(37000));
});
