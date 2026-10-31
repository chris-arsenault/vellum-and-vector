import { expect, it } from "vitest";
import { canonryMagicPresets, fieldInterpolator, gridPosition } from "@atlas/domain";
import { regionalEnvironment, regionalFixture } from "./refinementFixture";
import { channel, type RefinementState } from "./state";
import { fillRegionalPits, refineTerrain } from "./terrain";
import { routeRegionalWater } from "./water";
import { extractRegionalWater } from "./geography";
import { developMagicGeography } from "./magicEffects";
import { refineLivingCover, extractRegionalHabitats } from "./living";
import { surfaceCode, spatial, canonicalGeometry, rectangle } from "@atlas/domain";

/** Terrain context with no captured basins and no river entering across the frame. */
function openGround(state: RefinementState, basin: (i: number) => boolean = () => false) {
  const g = state.surface;
  state.terrain = {
    basin: g.coverage.scratch("uint8", "supplied-basins", g.active.length),
    inflow: g.coverage.scratch("float64", "supplied-inflow", g.active.length),
  };
  for (let i = 0; i < g.active.length; i++) state.terrain.basin.set(i, Number(basin(i)));
}

it("drains new sampling pits outside a captured basin while retaining the basin", () => {
  const { state, grid } = regionalFixture((x) => 100 + x / 1000, 40000, 2),
    g = state.surface,
    source = Array.from(grid.channels.elevation),
    pit = 5 * g.width + 5,
    inBowl = (i: number) => {
      const p = gridPosition(g, i);
      return (p.x - 25000) ** 2 + (p.y - 25000) ** 2 < 3000 ** 2;
    };
  openGround(state, inBowl);
  for (let i = 0; i < g.active.length; i++) {
    const p = gridPosition(g, i);
    g.channels.elevation.add(i, -100 * Math.exp(-((p.x - 25000) ** 2 + (p.y - 25000) ** 2) / 16e6));
  }
  g.channels.elevation.add(pit, -80);
  fillRegionalPits(state);
  routeRegionalWater(state);
  expect(g.channels.water.get(pit)).toBe(0);
  expect(Array.from(g.channels.water).some((value) => value === 2)).toBe(true);
  expect(Array.from(grid.channels.elevation)).toEqual(source);
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
  const before = Array.from(g.channels.elevation);
  extractRegionalWater(state);
  expect(g.lakes).toHaveLength(1);
  const lake = g.lakes![0],
    floor = fieldInterpolator(g, "elevation");
  expect(lake.level).toBe(stage);
  if (lake.geometry.type !== "Polygon") throw new Error("Expected one lake polygon");
  const errors = lake.geometry.coordinates[0].map(([x, y]) =>
    Math.abs(floor({ x, y, z: 0 }) - stage)
  );
  expect(Math.max(...errors)).toBeLessThan(10);
  expect(Array.from(g.channels.elevation)).toEqual(before);
});

it("develops dry rocky gullies without declaring them perennial streams", () => {
  const { state } = regionalFixture((x, y) => 100 + x / 100 + Math.abs(y - 10000) / 100, 20000, 2),
    g = state.surface;
  g.channels.treeCover.fill(0);
  g.channels.runoff.fill(0);
  g.channels.rainfall.fill(0);
  channel(state, "fracture", "ratio", 0.8);
  refineTerrain(state);
  routeRegionalWater(state);
  expect(Math.max(...g.channels.erosion)).toBeGreaterThan(30);
  expect(Array.from(g.channels.riverOrder).every((value) => value === 0)).toBe(true);
});

it("settles new point pits when magical physical changes reroute water", () => {
  const { state } = regionalFixture((x) => 100 + x / 1000, 40000, 2),
    g = state.surface,
    pit = 5 * g.width + 5,
    fire = canonryMagicPresets().find((system) => system.id === "fire")!,
    before = g.coverage.scratch("float64", "supplied-before-fire", g.active.length);
  openGround(state);
  routeRegionalWater(state);
  g.channels.elevation.add(pit, -80);
  channel(state, "magic:fire:intensity", "relative-intensity", 600);
  channel(state, "fracture", "ratio");
  channel(state, "ice", "ratio");
  developMagicGeography(state, [fire], new Map([["fire", before]]));
  expect(g.channels.water.get(pit)).toBe(0);
  expect(g.channels["magic:fire:intensity"].get(pit)).toBe(600);
});

it("keeps an unresolved pond in the field without cutting a hole in its surrounding forest", () => {
  const { state } = regionalEnvironment(),
    g = state.surface,
    pond = 3 * g.width + 4,
    receiver = g.coverage.scratch("int32", "supplied-outlets", g.active.length).fill(-1);
  state.drainage = { receiver, order: receiver, count: 0 };
  channel(state, "waterLevel", "metre", 100);
  g.channels.elevation.fill(200);
  g.channels.treeCover.fill(0.8);
  g.channels.naturalSurface.fill(surfaceCode("Temperate forest"));
  for (const i of [pond, ...[4, 5, 6].flatMap((y) => [10, 11, 12].map((x) => y * g.width + x))]) {
    g.channels.elevation.set(i, 90);
    g.channels.water.set(i, 2);
    g.channels.waterDepth.set(i, 10);
  }
  const water = Array.from(g.channels.water);
  extractRegionalWater(state);
  refineLivingCover(state);
  extractRegionalHabitats(state);
  expect(g.lakes).toHaveLength(1);
  expect(g.channels.naturalSurface.get(pond)).not.toBe(surfaceCode("Lake"));
  expect(g.channels.naturalSurface.get(5 * g.width + 11)).toBe(surfaceCode("Lake"));
  const forest = Object.values(state.domain.world.features).find(
    (feature) => feature.kind === "forest"
  );
  expect(forest).toBeDefined();
  expect(spatial.pointCoverage(forest!.geometry)(gridPosition(g, pond))).toBe(true);
  expect(Array.from(g.channels.water)).toEqual(water);
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
    routeRegionalWater(state);
    extractRegionalWater(state);
    expect(g.channels.water.get(center)).toBe(connected ? 1 : 0);
    if (connected) expect(spatial.pointCoverage(g.ocean!)(position)).toBe(true);
    else expect(g.ocean).toBeNull();
    expect(g.channels.temperature.get(center)).toBe(16);
  }
});

it("keeps a realized lake as water cover on the far side of a compact seam chart", () => {
  const { state } = regionalEnvironment(2),
    g = state.surface,
    reference = state.domain.world.reference,
    row = Math.floor(g.height / 2),
    column = Math.floor(g.width * 0.75),
    center = row * g.width + column,
    receiver = g.coverage.scratch("int32", "supplied-outlets", g.active.length).fill(-1);
  reference.boundaryMode = "cylinder";
  g.periodicWidth = 40000;
  g.bounds = [35000, 0, 45000, 20000];
  g.scope.footprint = canonicalGeometry(reference, rectangle(g.bounds));
  state.drainage = { receiver, order: receiver, count: 0 };
  channel(state, "waterLevel", "metre", 100);
  g.channels.elevation.fill(200);
  for (const dy of [-1, 0, 1])
    for (const dx of [-1, 0, 1]) {
      const i = (row + dy) * g.width + column + dx;
      g.channels.elevation.set(i, 90);
      g.channels.water.set(i, 2);
      g.channels.waterDepth.set(i, 10);
    }
  extractRegionalWater(state);
  expect(g.lakes).toHaveLength(1);
  expect(spatial.bounds(g.lakes![0].geometry)[2]).toBeLessThan(10000);
  expect(gridPosition(g, center).x).toBeGreaterThan(40000);
  refineLivingCover(state);
  expect(g.channels.naturalSurface.get(center)).toBe(surfaceCode("Lake"));
  expect(g.channels.waterDepth.get(center)).toBe(10);
});
