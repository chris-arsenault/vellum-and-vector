import { expect, it } from "vitest";
import { gridPosition } from "@atlas/domain";
import { regionalFixture } from "./refinementFixture";
import { fillRegionalPits, refineTerrain } from "./terrain";
import { refineWater, routeRegionalWater } from "./water";
import { channel, neighbors, type RefinementState } from "./state";

const mountain = (x: number, y: number) => 100 + x / 25 + Math.abs(y - 20000) / 12;
const rivers = (state: RefinementState) =>
  Array.from(state.surface.channels.riverOrder).filter((r) => r > 0).length;

it("develops branching valleys in mountain relief and drains every sampling pit", () => {
  const { state, grid } = regionalFixture(mountain, 40000, 2),
    g = state.surface,
    captured = Array.from(grid.channels.elevation);
  refineTerrain(state);
  refineWater(state);
  expect(Math.max(...g.channels.erosion)).toBeGreaterThan(40);
  expect(Array.from(g.channels.water).some((v) => v === 2)).toBe(false);
  for (let i = 0; i < g.active.length; i++)
    if (g.channels.water.get(i) === 0)
      expect(g.channels.drainageElevation.get(i) - g.channels.elevation.get(i)).toBeLessThan(1e-3);
  const { receiver } = state.drainage!,
    tributaries = new Int32Array(g.active.length);
  for (let i = 0; i < g.active.length; i++) {
    const j = receiver.get(i);
    if (j >= 0 && g.channels.riverOrder.get(i) > 0 && g.channels.riverOrder.get(j) > 0)
      tributaries[j]++;
  }
  expect(tributaries.some((count) => count > 1)).toBe(true);
  expect(Array.from(grid.channels.elevation)).toEqual(captured);
});

it("keeps a captured lake's basin as standing water", () => {
  const bowl = (x: number, y: number) => 100 + ((x - 20000) ** 2 + (y - 20000) ** 2) / 2e6,
    { state } = regionalFixture(bowl, 40000, 2),
    g = state.surface,
    water = channel(state, "water", "category");
  for (let i = 0; i < g.active.length; i++) {
    const p = gridPosition(g, i);
    if ((p.x - 20000) ** 2 + (p.y - 20000) ** 2 < 4000 ** 2) water.set(i, 2);
  }
  refineTerrain(state);
  refineWater(state);
  const center = Math.floor(g.height / 2) * g.width + Math.floor(g.width / 2);
  expect(g.channels.water.get(center)).toBe(2);
  expect(g.channels.water.get(g.width + 1)).toBe(0);
});

it("draws fewer rivers on dry ground than on wet ground of the same relief", () => {
  const wet = regionalFixture(mountain, 40000, 2).state,
    dry = regionalFixture(mountain, 40000, 2).state;
  dry.surface.channels.runoff.fill(0.03);
  for (const state of [wet, dry]) {
    refineTerrain(state);
    refineWater(state);
  }
  expect(rivers(wet)).toBeGreaterThan(0);
  expect(rivers(dry)).toBeLessThan(rivers(wet) / 2);
  expect(Math.max(...dry.surface.channels.erosion)).toBeGreaterThan(30);
});

it("carries a captured river entering across the frame edge into the region", () => {
  const { state } = regionalFixture((x) => 100 + x / 100, 20000, 2),
    g = state.surface,
    row = Math.floor(g.height / 2),
    inlet = row * g.width + g.width - 1,
    order = channel(state, "riverOrder", "category"),
    flow = channel(state, "flow", "cubic-metre/second");
  for (const dy of [-1, 0, 1]) {
    order.set(inlet + dy * g.width, 2);
    flow.set(inlet + dy * g.width, dy ? 20 : 50);
  }
  refineTerrain(state);
  refineWater(state);
  expect(state.terrain!.inflow.get(inlet)).toBeCloseTo(50, 6);
  expect(Math.max(...g.channels.flow)).toBeGreaterThan(50);
  const below = [...neighbors(g, inlet)].map((j) => g.channels.riverOrder.get(j));
  expect(Math.max(...below)).toBeGreaterThan(0);
});

it("does not invent flowing streams merely by labelling the same physical mesh finer", () => {
  const height = (x: number, y: number) => 100 + x / 1000 + Math.abs(y - 20000) / 400,
    first = regionalFixture(height, 40000, 2).state,
    second = regionalFixture(height, 40000, 2).state;
  for (const state of [first, second]) state.surface.channels.runoff.fill(0.01);
  second.surface.scope.resolution! /= 10;
  routeRegionalWater(first);
  routeRegionalWater(second);
  expect(Array.from(second.surface.channels.riverOrder)).toEqual(
    Array.from(first.surface.channels.riverOrder)
  );
});

it("supports fewer lakes on fractured permeable ground than sealed ground", () => {
  const bowl = (x: number, y: number) => 100 + ((x - 20000) ** 2 + (y - 10000) ** 2) / 1e6,
    sealed = regionalFixture(bowl).state,
    leaky = regionalFixture(bowl).state;
  for (const state of [sealed, leaky]) {
    state.surface.channels.rainfall.fill(0.9);
    state.surface.channels.runoff.fill(0.05);
    state.surface.channels.temperature.fill(10);
    channel(state, "fracture", "ratio", state === leaky ? 1 : 0);
    routeRegionalWater(state);
  }
  const water = (state: typeof sealed) =>
    Array.from(state.surface.channels.water).filter((v) => v === 2).length;
  expect(water(sealed)).toBeGreaterThan(0);
  expect(water(leaky)).toBeLessThan(water(sealed));
  expect(Array.from(leaky.surface.channels.elevation)).toEqual(
    Array.from(sealed.surface.channels.elevation)
  );
});

it("replaces coarse floodplain coverage with local flowing channel margins", () => {
  const { state } = regionalFixture((x, y) => 100 + x / 1000 + Math.abs(y - 20000) / 400, 40000, 2),
    g = state.surface;
  channel(state, "floodplain", "ratio", 1);
  channel(state, "delta", "ratio", 1);
  g.channels.runoff.fill(0.00001);
  routeRegionalWater(state);
  expect(Array.from(g.channels.floodplain).every((v) => v === 0)).toBe(true);
  expect(Array.from(g.channels.delta).every((v) => v === 0)).toBe(true);
  expect(Array.from(g.channels.rainfall).every((v) => Math.abs(v - 1.2) < 1e-8)).toBe(true);
});

it("keeps a substantial new basin as a lake after a later change, but drains a point pit", () => {
  const { state } = regionalFixture((x) => 100 + x / 1000, 40000, 2),
    g = state.surface,
    pit = 5 * g.width + 5;
  refineTerrain(state);
  for (let i = 0; i < g.active.length; i++) {
    const p = gridPosition(g, i),
      radius = ((p.x - 25000) / 4000) ** 2 + ((p.y - 25000) / 4000) ** 2;
    g.channels.elevation.add(i, -100 * Math.exp(-radius));
  }
  g.channels.elevation.add(pit, -80);
  fillRegionalPits(state);
  routeRegionalWater(state);
  expect(Array.from(g.channels.water).some((v) => v === 2)).toBe(true);
  expect(g.channels.water.get(pit)).toBe(0);
});
