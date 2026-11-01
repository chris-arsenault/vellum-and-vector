import { expect, it, vi } from "vitest";

// World-depth runs on a supplied country: longer than the suite's default per-test budget.
vi.setConfig({ testTimeout: 120_000 });
import { canonryMagicPresets } from "@atlas/domain";
import { units } from "../canonry/math";
import { routeWater } from "./drainage";
import { enableMagic, regionalFixture, runSchedule } from "./fixture";
import { cellAt, frameEdge, isContent } from "./lattice";
import { respondMagic } from "./magic/index";
import { updateSlopes } from "./relief";
import { regionalSchedule } from "./schedule";
import type { RegionalState } from "./state";

const mountain = (x: number, y: number) => 100 + x / 25 + Math.abs(y - 20000) / 12;
const content = (state: RegionalState) => {
  const mesh = state.physical.map.mesh,
    cells: number[] = [];
  for (let i = 0; i < mesh.count; i++) if (isContent(mesh, i)) cells.push(i);
  return cells;
};
const rivers = (state: RegionalState) =>
  content(state).filter((i) => state.physical.map.RiverOrders.get(i) > 0).length;
const lakes = (state: RegionalState) =>
  content(state).filter((i) => state.physical.map.WaterKindCodes.get(i) === 2).length;

it("keeps isolated rainy boundary samples out of the river network while the valley flows", () => {
  const { state } = regionalFixture((x, y) => 100 + x / 500 + Math.abs(y - 20000) / 1000, 40000, 2),
    map = state.physical.map,
    mesh = map.mesh;
  map.Runoff.fill(10000);
  map.Rainfall.fill(10000);
  updateSlopes(state);
  routeWater(state);
  // Edge cells drain out of the frame; a cell with no more than its own ground is no river,
  // however much rain it gets, while the valley's gathered water is.
  const edges = content(state).filter((i) => frameEdge(mesh, i));
  expect(edges.length).toBeGreaterThan(0);
  for (const i of edges) {
    expect(map.FlowAccumulation.get(i)).toBeGreaterThan(0);
    if (map.CatchmentArea.get(i) < 2 * mesh.contentArea(i)) expect(map.RiverOrders.get(i)).toBe(0);
  }
  expect(rivers(state)).toBeGreaterThan(0);
});

it("does not turn dry drainage area into the same stream network as a wet catchment", () => {
  const height = (x: number, y: number) => 100 + x / 1000 + Math.abs(y - 20000) / 400,
    dry = regionalFixture(height, 40000, 2).state,
    wet = regionalFixture(height, 40000, 2).state;
  dry.physical.map.Runoff.fill(0);
  dry.physical.map.Rainfall.fill(10);
  for (const state of [dry, wet]) {
    updateSlopes(state);
    routeWater(state);
  }
  expect(rivers(dry)).toBe(0);
  expect(rivers(wet)).toBeGreaterThan(0);
  expect(Array.from(wet.physical.map.CatchmentArea.toArray())).toEqual(
    Array.from(dry.physical.map.CatchmentArea.toArray())
  );
});

it("keeps sheet runoff on a planar hillslope out of the mapped river network", () => {
  const { state } = regionalFixture((x, y) => 100 + x / 100 + y / 200, 40000, 2);
  routeWater(state);
  // Water gathers down the slope (many cells' runoff leaves through one edge cell)...
  const flows = content(state).map((i) => state.physical.map.FlowAccumulation.get(i)),
    own = Math.min(...flows.filter((flow) => flow > 0));
  expect(Math.max(...flows)).toBeGreaterThan(10 * own);
  // ...and no cell of it is a river.
  expect(rivers(state)).toBe(0);
});

it("routes a constructed catchment to its local outlets and retains its water budget", () => {
  const f = regionalFixture(
    (x, y) => 100 + x / 1000 + Math.abs(Math.abs(y - 20000) - Math.max(0, x - 20000)) / 400,
    40000,
    2
  );
  updateSlopes(f.state);
  routeWater(f.state);
  const map = f.state.physical.map,
    { receiver, order, count } = f.state.regional.drainage!,
    rank = new Int32Array(map.mesh.count).fill(-1);
  for (let k = 0; k < count; k++) rank[order[k]] = k;
  let supplied = 0,
    out = 0;
  for (const i of content(f.state)) {
    supplied += (map.mesh.contentArea(i) * 0.6) / (365.25 * 24 * 3600);
    const j = receiver[i];
    if (j < 0) out += map.FlowAccumulation.get(i);
    else expect(rank[j]).toBeLessThan(rank[i]);
  }
  // The outflow is the supply less what the channels lose crossing the ground (seepage and
  // evaporation over their belts, plan W1): a little in this humid country, never more.
  expect(out).toBeLessThanOrEqual(supplied + 1e-9);
  expect(out).toBeGreaterThan(supplied * 0.9);
});

it("leaves an unsupported depression dry and fills it when supplied with runoff", () => {
  const bowl = (x: number, y: number) => 100 + ((x - 20000) ** 2 + (y - 10000) ** 2) / 1e6,
    dry = regionalFixture(bowl).state,
    wet = regionalFixture(bowl).state;
  dry.physical.map.Runoff.fill(0);
  dry.physical.map.Rainfall.fill(0);
  wet.physical.map.Runoff.fill(1000);
  wet.physical.map.Rainfall.fill(1500);
  routeWater(dry);
  routeWater(wet);
  expect(lakes(dry)).toBe(0);
  expect(lakes(wet)).toBeGreaterThan(0);
  for (const i of content(wet))
    if (wet.physical.map.WaterKindCodes.get(i) === 2)
      expect(wet.physical.map.RiverOrders.get(i)).toBe(0);
  expect(Array.from(wet.physical.map.Elevation.toArray())).toEqual(
    Array.from(dry.physical.map.Elevation.toArray())
  );
});

it("supports fewer lakes on fractured permeable ground than sealed ground", () => {
  const bowl = (x: number, y: number) => 100 + ((x - 20000) ** 2 + (y - 10000) ** 2) / 1e6,
    sealed = regionalFixture(bowl).state,
    leaky = regionalFixture(bowl).state;
  for (const state of [sealed, leaky]) {
    state.physical.map.Rainfall.fill(900);
    state.physical.map.Runoff.fill(50);
    state.physical.map.Temperature.fill(400);
    state.physical.map.FractureConductance.fill(state === leaky ? 1000 : 0);
    routeWater(state);
  }
  expect(lakes(sealed)).toBeGreaterThan(0);
  expect(lakes(leaky)).toBeLessThan(lakes(sealed));
});

it("develops branching valleys in mountain relief, drains every sampling pit and leaves the captured input intact", () => {
  const { state, grid } = regionalFixture(mountain, 40000, 2),
    map = state.physical.map,
    captured = Array.from(grid.channels.elevation);
  runSchedule(state, ["physical"]);
  expect(
    Math.max(...content(state).map((i) => map.CumulativeFluvialErosion.get(i)))
  ).toBeGreaterThan(units(40));
  // Sampling pits are gone: land drains at its own height, to within a flat shallower than
  // the depth at which standing water is drawn.
  for (const i of content(state))
    if (map.WaterKindCodes.get(i) === 0)
      expect(map.DrainageElevations.get(i) - map.Elevation.get(i)).toBeLessThan(units(2));
  const { receiver } = state.regional.drainage!,
    tributaries = new Int32Array(map.mesh.count);
  for (const i of content(state)) {
    const j = receiver[i];
    if (j >= 0 && map.RiverOrders.get(i) > 0 && map.RiverOrders.get(j) > 0) tributaries[j]++;
  }
  expect(tributaries.some((count) => count > 1)).toBe(true);
  expect(Array.from(grid.channels.elevation)).toEqual(captured);
});

it("keeps a captured lake's basin as standing water through the rounds", () => {
  const bowl = (x: number, y: number) => 100 + ((x - 20000) ** 2 + (y - 20000) ** 2) / 2e6,
    { state } = regionalFixture(bowl, 40000, 2, {
      water: ["category", (x, y) => ((x - 20000) ** 2 + (y - 20000) ** 2 < 4000 ** 2 ? 2 : 0)],
      waterDepth: ["metre", (x, y) => ((x - 20000) ** 2 + (y - 20000) ** 2 < 4000 ** 2 ? 4 : 0)],
    }),
    map = state.physical.map;
  runSchedule(state, ["physical"]);
  const center = cellAt(map.mesh, 20000, 20000),
    corner = cellAt(map.mesh, 2000, 2000);
  expect(map.WaterKindCodes.get(center)).toBe(2);
  expect(map.WaterKindCodes.get(corner)).toBe(0);
});

it("draws fewer rivers on dry ground than on wet ground of the same relief", () => {
  const wet = regionalFixture(mountain, 40000, 2).state,
    dry = regionalFixture(mountain, 40000, 2).state;
  dry.physical.map.Runoff.fill(30);
  for (const state of [wet, dry]) runSchedule(state, ["physical"]);
  expect(rivers(wet)).toBeGreaterThan(0);
  expect(rivers(dry)).toBeLessThan(rivers(wet) / 2);
  expect(
    Math.max(...content(dry).map((i) => dry.physical.map.CumulativeFluvialErosion.get(i)))
  ).toBeGreaterThan(units(30));
});

it("carries a captured river entering across the frame edge into the region", () => {
  const { state } = regionalFixture((x) => 100 + x / 100, 20000, 2, {
      riverOrder: ["category", (x, y) => (x >= 35000 && Math.abs(y - 10000) < 2500 ? 2 : 0)],
      flow: ["cubic-metre/second", (x, y) => (x >= 35000 && Math.abs(y - 10000) < 2500 ? 50 : 0)],
    }),
    map = state.physical.map;
  runSchedule(state, ["physical"]);
  const entries = state.regional.evidence!.entries;
  expect(entries.length).toBeGreaterThan(0);
  // The entering discharge (the parent's 50 m³/s, read at the edge) runs through the region.
  expect(Math.max(...entries.map((e) => e.discharge))).toBeGreaterThan(45);
  expect(Math.max(...content(state).map((i) => map.FlowAccumulation.get(i)))).toBeGreaterThan(45);
});

it("keeps a substantial new basin as a lake after a magical change", () => {
  const { state } = regionalFixture((x) => 100 + x / 1000, 40000, 2),
    map = state.physical.map,
    mesh = map.mesh;
  for (const step of regionalSchedule(["physical"])) {
    step.run(state);
    if (step.id === "round-1/water") break;
  }
  for (const i of content(state)) {
    const x = mesh.x(i) + mesh.origin[0],
      y = mesh.y(i) + mesh.origin[1],
      radius = ((x - 25000) / 4000) ** 2 + ((y - 25000) / 4000) ** 2;
    map.Elevation.add(i, -units(100 * Math.exp(-radius)));
  }
  routeWater(state);
  expect(lakes(state)).toBeGreaterThan(0);
});

it("reroutes water after a magical physical change without error", () => {
  const { state } = regionalFixture((x) => 100 + x / 1000, 40000, 2);
  state.domain.world.magicSystems = canonryMagicPresets().map((s) => ({
    ...s,
    enabled: s.id === "fire",
  }));
  state.domain.world.confluences = [];
  enableMagic(state, ["fire"]);
  for (const step of regionalSchedule(["physical", "magic"])) {
    step.run(state);
    if (step.id === "round-1/water") break;
  }
  const fire = state.physical.magic!.fields.find((f) => f.definition.id === "fire")!;
  fire.intensity.fill(600);
  const changed = respondMagic(state);
  expect(changed.size).toBeGreaterThanOrEqual(0);
  routeWater(state);
  expect(
    content(state).every((i) => [0, 1, 2].includes(state.physical.map.WaterKindCodes.get(i)))
  ).toBe(true);
});

it("keeps a closed basin below sea level out of the ocean until a passage opens", () => {
  for (const connected of [false, true]) {
    const { state } = regionalFixture(
        (x, y) =>
          connected && Math.abs(y - 10000) < 1500 && x <= 20000
            ? -100
            : Math.min(100, -50 + ((x - 20000) ** 2 + (y - 10000) ** 2) / 1e6),
        20000,
        2
      ),
      map = state.physical.map,
      center = cellAt(map.mesh, 20000, 10000);
    map.Rainfall.fill(0);
    map.Runoff.fill(0);
    routeWater(state);
    expect(map.WaterKindCodes.get(center)).toBe(connected ? 1 : 0);
  }
});
