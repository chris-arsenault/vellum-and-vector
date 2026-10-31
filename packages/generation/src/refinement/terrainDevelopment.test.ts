import { expect, it } from "vitest";
import { regionalFixture } from "./refinementFixture";
import { refineTerrain } from "./terrain";
import { refineWater, routeRegionalWater } from "./water";
import { channel, neighbors } from "./state";
import { settleRegionalPits } from "./terrainStructure";
import { gridPosition } from "@atlas/domain";
import { inciseRegionalValleys } from "./valleys";
import { regionalEnvironment } from "./refinementFixture";

it("dissects a sloping plain without making noise pits into a field of lakes", () => {
  const { state, grid } = regionalFixture((x, y) => 100 + x / 1000 + y / 2000, 40000, 2),
    captured = Array.from(grid.channels.elevation);
  refineTerrain(state);
  refineWater(state);
  expect(Array.from(state.surface.channels.water).filter((v) => v === 2)).toHaveLength(0);
  expect(Array.from(grid.channels.elevation)).toEqual(captured);
});

it("cuts connected valley floors and their hillsides into mountain relief", () => {
  const { state } = regionalFixture((x, y) => 100 + x / 25 + Math.abs(y - 20000) / 12, 40000, 2),
    g = state.surface;
  refineTerrain(state);
  refineWater(state);
  const erosion = g.channels.erosion,
    floors = Array.from(g.channels.riverOrder).flatMap((r, i) => (r > 0 ? [i] : []));
  expect(Math.max(...erosion)).toBeGreaterThan(40);
  expect(
    floors.some((i) =>
      [...neighbors(g, i)].some((j) => g.channels.riverOrder.get(j) === 0 && erosion.get(j) > 10)
    )
  ).toBe(true);
  for (const i of floors) {
    const j = state.drainage!.receiver.get(i);
    if (j >= 0 && g.channels.water.get(i) === 0)
      expect(g.channels.elevation.get(i)).toBeGreaterThanOrEqual(g.channels.elevation.get(j));
  }
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

it("allows a new coherent basin to become a lake without a captured basin or height lock", () => {
  const { state, grid } = regionalFixture((x) => 100 + x / 1000, 40000, 2),
    g = state.surface,
    captured = Array.from(grid.channels.elevation);
  state.terrain = {
    basin: g.coverage.scratch("uint8", "supplied-nonbasin", g.active.length),
    relief: g.coverage.scratch("float64", "supplied-relief", g.active.length).fill(100),
  };
  for (let i = 0; i < g.active.length; i++) {
    const p = gridPosition(g, i),
      radius = ((p.x - 20000) / 4000) ** 2 + ((p.y - 20000) / 4000) ** 2;
    g.channels.elevation.add(i, -100 * Math.exp(-radius));
  }
  settleRegionalPits(state);
  routeRegionalWater(state);
  expect(Array.from(g.channels.water).some((v) => v === 2)).toBe(true);
  expect(Array.from(grid.channels.elevation)).toEqual(captured);
});

it("develops valley walls on both flanks by distance, even where their old routes run parallel", () => {
  const { state } = regionalEnvironment(),
    g = state.surface,
    receiver = g.coverage.scratch("int32", "supplied-parallel-routes", g.active.length).fill(-1),
    order = g.coverage.scratch("int32", "supplied-order", g.active.length),
    row = Math.floor(g.height / 2),
    x = Math.floor(g.width / 2),
    center = row * g.width + x;
  state.drainage = { receiver, order, count: g.active.length };
  channel(state, "flow", "cubic-metre/second", 100);
  g.channels.catchmentArea.fill(1e9);
  for (let i = 0; i < g.active.length; i++) {
    const col = i % g.width;
    order.set(i, i);
    if (col) receiver.set(i, i - 1);
    g.channels.elevation.set(i, 100 + col * 300);
  }
  for (let col = 1; col < g.width; col++) g.channels.riverOrder.set(row * g.width + col, 2);
  state.inheritedHeight.copyFrom(g.channels.elevation);
  const input = Array.from(state.inheritedHeight);
  inciseRegionalValleys(state);
  const erosion = g.channels.erosion;
  expect(erosion.get(center)).toBeGreaterThan(40);
  expect(erosion.get(center - g.width)).toBeGreaterThan(10);
  expect(erosion.get(center + g.width)).toBeCloseTo(erosion.get(center - g.width), 6);
  expect(erosion.get(center + g.width * 2)).toBeLessThan(erosion.get(center + g.width));
  expect(Array.from(state.inheritedHeight)).toEqual(input);
});
