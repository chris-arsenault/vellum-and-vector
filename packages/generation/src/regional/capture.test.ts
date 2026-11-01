import { expect, it, vi } from "vitest";
import {
  createGrid,
  fieldInterpolator,
  generateBand,
  gridPosition,
  putChannel,
  rectangle,
  spatial,
} from "@atlas/domain";
import { createRegionalState, refinementReads, refinementResolution } from "./capture";
import { putRegionalFeature, putRegionalNetwork } from "./extraction/features";
import { regionalFixture } from "./fixture";
import { prepareAtlasGeneration } from "../atlasWorkflow";
import { prepareRegionalRefinement } from "./workflow";
import { regionalPublications } from "./extraction/publication";
import { regionalEnvironment } from "./fixture";
import { channel } from "./state";

it("samples distinct dry interior, wet coast and southeastern relief at their own positions", () => {
  const f = regionalFixture((x, y) =>
      y < 5000 ? -10 + y / 100 : 200 + Math.max(0, x - 20000) / 10
    ),
    grid = f.grid;
  for (let i = 0; i < grid.active.length; i++) {
    const p = gridPosition(grid, i);
    grid.channels.rainfall.set(i, p.y < 5000 ? 1.5 : 0.05);
    grid.channels.moisture.set(i, 0.9);
  }
  const state = createRegionalState(f.source, f.input),
    g = state.surface;
  for (let i = 0; i < g.active.length; i++) {
    const p = gridPosition(g, i);
    if (p.y > 10000) expect(g.channels.rainfall.get(i)).toBeCloseTo(0.05, 6);
    if (p.x > 35000 && p.y > 10000) expect(g.channels.elevation.get(i)).toBeGreaterThan(1700);
    if (p.x < 15000 && p.y > 10000) expect(g.channels.elevation.get(i)).toBeCloseTo(200, 6);
  }
});

it("prepares a dedicated regional schedule and rejects accidental world initialization", () => {
  const f = regionalFixture();
  expect(() => prepareAtlasGeneration(f.source, f.input)).toThrow("dedicated regional preparation");
  const prepared = prepareRegionalRefinement(f.source, f.input);
  expect(prepared.diagnostics).toEqual([]);
  const ids = prepared.input.configuration.sequence.map((s) => s.process);
  expect(ids.every((id) => id.startsWith("refinement."))).toBe(true);
  expect(ids.filter((id) => /round-\d\/terrain/.test(id))).toHaveLength(3);
  expect(ids.at(-1)).toBe("refinement.descendant-context");
});

it("samples captured material amounts by area rather than duplicating a coarse cell's stock", () => {
  const f = regionalFixture(),
    name = "magic:aurora:stock:field/ice";
  putChannel(
    f.grid,
    name,
    "intensity-square-metre",
    generateBand(f.grid.coverage, "float64", name, (i) => f.grid.measures.get(i) * 42),
    "extensive"
  );
  f.source.world.fields[0].channels!.push(name);
  const before = Array.from(f.grid.channels[name]),
    next = createRegionalState(f.source, f.input);
  for (let i = 0; i < next.surface.active.length; i++)
    expect(next.surface.channels[name].get(i) / next.surface.measures.get(i)).toBeCloseTo(42, 8);
  expect(Array.from(f.grid.channels[name])).toEqual(before);
});

it("ignores sibling fields and world historical channels when sampling the target", () => {
  const f = regionalFixture();
  f.source.world.fields.push({ ...f.source.world.fields[0], id: "sibling", areaId: "sibling" });
  f.source.numerical.sibling = {
    ...f.grid,
    channels: {
      ...f.grid.channels,
      elevation: f.grid.coverage.copyBand(f.grid.channels.elevation).fill(9000),
    },
  };
  f.grid.channels.tectonicHistory = f.grid.coverage.copyBand(f.grid.channels.elevation).fill(42);
  f.grid.units.tectonicHistory = "ratio";
  const next = createRegionalState(f.source, f.input);
  expect(next.surface.channels.tectonicHistory).toBeUndefined();
  expect(refinementReads(f.source, "area").map((r) => r.fieldId)).toEqual(["captured"]);
  expect(Array.from(next.surface.channels.elevation)).toEqual(
    Array.from(f.state.surface.channels.elevation)
  );
});

it.each([5, 65])("uses present terrain at width %i during society-only generation", (width) => {
  const f = regionalFixture(() => 100),
    current = createGrid("current-surface", { ...f.grid.scope }, width, (width + 1) / 2);
  putChannel(
    current,
    "elevation",
    "metre",
    generateBand(current.coverage, "float64", "current-height", () => 450)
  );
  f.source.numerical[current.id] = current;
  f.source.world.fields.push({ ...f.source.world.fields[0], id: current.id, input: false });
  const next = createRegionalState(f.source, { ...f.input, domains: ["built"] });
  if (width === 65) expect(next.surface.width).toBe(65);
  for (const h of next.surface.channels.elevation) expect(h).toBeCloseTo(450, 8);
});

it("keeps world-bound reads independent of the regional sample count", () => {
  const f = regionalFixture((x) => 100 + Math.sin((x / 40000) * Math.PI * 2) * 100);
  f.source.world.reference.boundaryMode = "cylinder";
  const bounds = vi.spyOn(spatial, "bounds");
  try {
    const state = createRegionalState(f.source, f.input);
    const reads = (current: ReturnType<typeof createRegionalState>) =>
        bounds.mock.calls.filter(([geometry]) => geometry === current.domain.world.reference.domain)
          .length,
      count = reads(state);
    bounds.mockClear();
    const draft = createRegionalState(f.source, { ...f.input, quality: "draft" });
    expect(draft.surface.active.length).not.toBe(state.surface.active.length);
    expect(reads(draft)).toBe(count);
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
  const state = createRegionalState(f.source, f.input),
    g = state.surface;
  expect(g.bounds[2] - g.bounds[0]).toBeLessThan(12000);
  expect(fieldInterpolator(g, "elevation")({ x: 39000, y: 8000, z: 0 })).toBeLessThan(100);
  expect(fieldInterpolator(g, "elevation")({ x: 1000, y: 8000, z: 0 })).toBeGreaterThan(100);
  const coordinates = [
      [39000, 8000],
      [41000, 8000],
    ],
    feature = putRegionalFeature(state, "seam-river", "river", "rivers", {
      type: "LineString",
      coordinates,
    });
  expect(feature.geometry.type).toBe("MultiLineString");
  putRegionalNetwork(state, feature, 2, coordinates);
  const reach = Object.values(state.domain.world.networkReaches!)[0];
  expect(spatial.length(reach.geometry)).toBeCloseTo(2000, 5);
  expect(state.domain.world.networkNodes![reach.start].position.x).toBe(39000);
  expect(state.domain.world.networkNodes![reach.end].position.x).toBe(1000);
});

it("leaves a physical neighborhood around the subject for coastal development", () => {
  const f = regionalFixture();
  f.source.world.areas.area.footprint = rectangle([10000, 5000, 30000, 15000]);
  const state = createRegionalState(f.source, f.input);
  expect(state.surface.bounds[0]).toBeLessThan(10000);
  expect(state.surface.bounds[2]).toBeGreaterThan(30000);
  expect(state.domain.world.areas.area.footprint).toEqual(state.surface.scope.footprint);
  expect(f.source.world.areas.area.footprint).toEqual(rectangle([10000, 5000, 30000, 15000]));
});

it("calibrates the first Standard region from 35 percent of the default world divided twelve ways", () => {
  const { source, input } = regionalFixture();
  const regionArea = (4_000_000 * 3_000_000 * 0.35) / 12;
  expect(refinementResolution(source, input).cellArea).toBeCloseTo(regionArea / 60_000, 6);
  source.world.areas.area.map = { ...source.world.areas.area.map!, refinementLevel: 2 };
  expect(refinementResolution(source, input).cellArea).toBeCloseTo(regionArea / 60_000 / 12, 6);
});

it("keeps ordinary same-level physical spacing fixed when the chosen extent changes", () => {
  const { source, input } = regionalFixture();
  source.world.reference.domain = rectangle([0, 0, 1_000_000, 1_000_000]);
  source.world.areas.area.footprint = rectangle([0, 0, 100_000, 100_000]);
  const first = refinementResolution(source, input);
  source.world.areas.area.footprint = rectangle([0, 0, 300_000, 300_000]);
  expect(refinementResolution(source, input).cellSpan).toBe(first.cellSpan);
  expect(first.cellSpan).toBeCloseTo(2415.22946, 4);
});

it("publishes derived occupation using the existing population layer definition", () => {
  const { state } = regionalEnvironment();
  channel(state, "populationDensity", "people/square-kilometre", 100);
  delete state.domain.world.layers.population;
  const definition = regionalPublications(state).find(
    (d) => d.kind === "field" && d.channel === "populationDensity"
  );
  expect(definition?.layer).toMatchObject({ id: "population", name: "Population and livelihoods" });
});
