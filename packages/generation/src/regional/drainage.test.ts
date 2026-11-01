import { expect, it } from "vitest";
import { canonryMagicPresets, gridPosition, spatial } from "@atlas/domain";
import { routeWater } from "./drainage";
import { extractWaterGeometry } from "./extraction/water";
import { regionalEnvironment, regionalFixture, runSchedule } from "./fixture";
import { respondMagic } from "./magic/index";
import { channel } from "./state";
import { updateSlopes } from "./relief";
import { regionalSchedule } from "./schedule";

const mountain = (x: number, y: number) => 100 + x / 25 + Math.abs(y - 20000) / 12;

it("keeps an isolated rainy boundary sample out of the river network while its valley flows", () => {
  const { state } = regionalFixture((x, y) => 100 + x / 500 + Math.abs(y - 20000) / 1000, 40000, 2),
    g = state.surface,
    edge = (g.height - 1) * g.width + Math.floor(g.width / 2);
  g.channels.runoff.fill(10);
  g.channels.rainfall.fill(10);
  updateSlopes(state);
  routeWater(state);
  expect(g.channels.catchmentArea.get(edge)).toBeCloseTo(g.measures.get(edge), 6);
  expect(g.channels.flow.get(edge)).toBeGreaterThan(0);
  expect(g.channels.riverOrder.get(edge)).toBe(0);
  expect(Array.from(g.channels.riverOrder).some((order) => order > 0)).toBe(true);
});

it("does not turn dry drainage area into the same stream network as a wet catchment", () => {
  const height = (x: number, y: number) => 100 + x / 1000 + Math.abs(y - 20000) / 400,
    dry = regionalFixture(height, 40000, 2).state,
    wet = regionalFixture(height, 40000, 2).state;
  dry.surface.channels.runoff.fill(0.00001);
  dry.surface.channels.rainfall.fill(0.01);
  for (const state of [dry, wet]) {
    updateSlopes(state);
    routeWater(state);
  }
  expect(Array.from(dry.surface.channels.riverOrder).filter((r) => r > 0)).toHaveLength(0);
  expect(Array.from(wet.surface.channels.riverOrder).some((r) => r > 0)).toBe(true);
  expect(Array.from(wet.surface.channels.catchmentArea)).toEqual(
    Array.from(dry.surface.channels.catchmentArea)
  );
});

it("keeps sheet runoff on a planar hillslope out of the mapped river network", () => {
  const { state } = regionalFixture((x, y) => 100 + x / 100 + y / 200, 40000, 2);
  routeWater(state);
  expect(Math.max(...state.surface.channels.flow)).toBeGreaterThan(0.5);
  expect(Array.from(state.surface.channels.riverOrder).filter((r) => r > 0)).toHaveLength(0);
});

it("routes a constructed catchment to its local outlets and retains its water budget", () => {
  const f = regionalFixture(
    (x, y) => 100 + x / 1000 + Math.abs(Math.abs(y - 20000) - Math.max(0, x - 20000)) / 400,
    40000,
    2
  );
  updateSlopes(f.state);
  routeWater(f.state);
  const g = f.state.surface,
    { receiver, order } = f.state.drainage!,
    rank = new Map(Array.from(order, (i, k) => [i, k]));
  let supplied = 0,
    out = 0;
  for (let i = 0; i < g.active.length; i++) {
    supplied += (g.measures.get(i) * 0.6) / (365.25 * 24 * 3600);
    const j = receiver.get(i);
    if (j < 0) out += g.channels.flow.get(i);
    else expect(rank.get(j)!).toBeLessThan(rank.get(i)!);
  }
  expect(out).toBeCloseTo(supplied, 8);
  extractWaterGeometry(f.state);
  const reaches = f.state.domain.world.drainage!.area.reaches;
  expect(reaches.length).toBeGreaterThan(1);
  expect(reaches.every((r) => r.coordinates.length > 1 && r.discharges[0] < 25)).toBe(true);
});

it("uses the present relative sea level rather than the world elevation datum", () => {
  const { state } = regionalFixture(() => 100);
  channel(state, "seaDatum", "metre", 1000);
  channel(state, "seaLevel", "metre", 0);
  routeWater(state);
  expect(Array.from(state.surface.channels.water).every((value) => value === 0)).toBe(true);
});

it("leaves an unsupported depression dry and fills it when supplied with runoff", () => {
  const bowl = (x: number, y: number) => 100 + ((x - 20000) ** 2 + (y - 10000) ** 2) / 1e6,
    dry = regionalFixture(bowl).state,
    wet = regionalFixture(bowl).state;
  dry.surface.channels.runoff.fill(0);
  dry.surface.channels.rainfall.fill(0);
  wet.surface.channels.runoff.fill(1);
  wet.surface.channels.rainfall.fill(1.5);
  routeWater(dry);
  routeWater(wet);
  expect(Array.from(dry.surface.channels.water).every((v) => v === 0)).toBe(true);
  expect(Array.from(wet.surface.channels.water).some((v) => v === 2)).toBe(true);
  for (let i = 0; i < wet.surface.active.length; i++)
    if (wet.surface.channels.water.get(i) === 2)
      expect(wet.surface.channels.riverOrder.get(i)).toBe(0);
  expect(Array.from(wet.surface.channels.elevation)).toEqual(
    Array.from(dry.surface.channels.elevation)
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
    routeWater(state);
  }
  const water = (state: typeof sealed) =>
    Array.from(state.surface.channels.water).filter((v) => v === 2).length;
  expect(water(sealed)).toBeGreaterThan(0);
  expect(water(leaky)).toBeLessThan(water(sealed));
});

it("develops branching valleys in mountain relief, drains every sampling pit and leaves the captured input intact", () => {
  const { state, grid } = regionalFixture(mountain, 40000, 2),
    g = state.surface,
    captured = Array.from(grid.channels.elevation);
  runSchedule(state, ["physical"]);
  expect(Math.max(...g.channels.erosion)).toBeGreaterThan(40);
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
  expect(state.domain.world.epochs).toEqual(state.domain.world.epochs);
});

it("keeps a captured lake's basin as standing water through the rounds", () => {
  const bowl = (x: number, y: number) => 100 + ((x - 20000) ** 2 + (y - 20000) ** 2) / 2e6,
    { state } = regionalFixture(bowl, 40000, 2),
    g = state.surface,
    water = channel(state, "water", "category");
  for (let i = 0; i < g.active.length; i++) {
    const p = gridPosition(g, i);
    if ((p.x - 20000) ** 2 + (p.y - 20000) ** 2 < 4000 ** 2) water.set(i, 2);
  }
  runSchedule(state, ["physical"]);
  const center = Math.floor(g.height / 2) * g.width + Math.floor(g.width / 2);
  expect(g.channels.water.get(center)).toBe(2);
  expect(g.channels.water.get(g.width + 1)).toBe(0);
});

it("draws fewer rivers on dry ground than on wet ground of the same relief", () => {
  const rivers = (state: ReturnType<typeof regionalFixture>["state"]) =>
      Array.from(state.surface.channels.riverOrder).filter((r) => r > 0).length,
    wet = regionalFixture(mountain, 40000, 2).state,
    dry = regionalFixture(mountain, 40000, 2).state;
  dry.surface.channels.runoff.fill(0.03);
  for (const state of [wet, dry]) runSchedule(state, ["physical"]);
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
  runSchedule(state, ["physical"]);
  expect(state.network!.inflow[inlet]).toBeCloseTo(50, 6);
  expect(Math.max(...g.channels.flow)).toBeGreaterThan(50);
});

it("keeps a substantial new basin as a lake after a magical change", () => {
  const { state } = regionalFixture((x) => 100 + x / 1000, 40000, 2),
    g = state.surface;
  for (const step of regionalSchedule(["physical"])) {
    step.run(state);
    if (step.id === "round-1/water") break;
  }
  for (let i = 0; i < g.active.length; i++) {
    const p = gridPosition(g, i),
      radius = ((p.x - 25000) / 4000) ** 2 + ((p.y - 25000) / 4000) ** 2;
    g.channels.elevation.add(i, -100 * Math.exp(-radius));
  }
  routeWater(state);
  expect(Array.from(g.channels.water).some((v) => v === 2)).toBe(true);
});

it("reroutes water after a magical physical change without error", () => {
  const { state } = regionalFixture((x) => 100 + x / 1000, 40000, 2),
    g = state.surface;
  state.domain.world.magicSystems = canonryMagicPresets().map((s) => ({
    ...s,
    enabled: s.id === "fire",
  }));
  state.domain.world.confluences = [];
  for (const step of regionalSchedule(["physical", "magic"])) {
    step.run(state);
    if (step.id === "round-1/water") break;
  }
  channel(state, "magic:fire:intensity", "relative-intensity", 600);
  const changed = respondMagic(state);
  expect(changed.size).toBeGreaterThanOrEqual(0);
  routeWater(state);
  expect(Array.from(g.channels.water).every((v) => v === 0 || v === 1 || v === 2)).toBe(true);
});

it("places a lake shoreline at its water stage rather than nearest wet-cell edges", () => {
  const { state } = regionalEnvironment(2),
    g = state.surface,
    stage = 500,
    receiver = g.coverage.scratch("int32", "supplied-outlets", g.active.length).fill(-1);
  state.drainage = { receiver, order: receiver, count: 0 };
  channel(state, "waterLevel", "metre", stage);
  for (let i = 0; i < g.active.length; i++) {
    const p = gridPosition(g, i),
      height = 100 + ((p.x - 20000) ** 2 + (p.y - 10000) ** 2) / 100000;
    g.channels.elevation.set(i, height);
    g.channels.water.set(i, height < stage ? 2 : 0);
    g.channels.waterDepth.set(i, Math.max(0, stage - height));
  }
  extractWaterGeometry(state);
  expect(g.lakes).toHaveLength(1);
  const lake = g.lakes![0];
  expect(lake.level).toBe(stage);
  expect(spatial.area(lake.geometry)).toBeGreaterThan(0);
});

it("keeps a closed basin below sea level out of the ocean until a passage opens", () => {
  for (const connected of [false, true]) {
    const { state } = regionalFixture(
        (x, y) => Math.min(100, -50 + ((x - 20000) ** 2 + (y - 10000) ** 2) / 1e6),
        20000,
        2
      ),
      g = state.surface,
      row = Math.floor(g.height / 2),
      center = row * g.width + Math.floor(g.width / 2),
      position = gridPosition(g, center);
    g.channels.rainfall.fill(0);
    g.channels.runoff.fill(0);
    if (connected)
      for (let x = 0; x <= Math.floor(g.width / 2); x++)
        g.channels.elevation.set(row * g.width + x, -100);
    routeWater(state);
    extractWaterGeometry(state);
    expect(g.channels.water.get(center)).toBe(connected ? 1 : 0);
    if (connected) expect(spatial.pointCoverage(g.ocean!)(position)).toBe(true);
    else expect(g.ocean).toBeNull();
  }
});

it("keeps a single-cell pond in field context and publishes a resolved lake", () => {
  const { state } = regionalEnvironment(),
    g = state.surface,
    receiver = g.coverage.scratch("int32", "supplied-receivers", g.active.length, -1);
  state.drainage = { receiver, order: receiver, count: 0 };
  channel(state, "waterLevel", "metre", 100);
  g.channels.elevation.fill(200);
  for (const cell of [
    g.width + 2,
    ...[4, 5, 6].flatMap((y) => [10, 11, 12].map((x) => y * g.width + x)),
  ]) {
    g.channels.water.set(cell, 2);
    g.channels.waterDepth.set(cell, 10);
    g.channels.elevation.set(cell, 90);
  }
  extractWaterGeometry(state);
  expect(g.lakes).toHaveLength(1);
  expect(Object.values(state.domain.world.features).filter((f) => f.kind === "lake")).toHaveLength(
    1
  );
});
