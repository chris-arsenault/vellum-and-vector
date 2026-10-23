import { expect, it } from "vitest";
import {
  createGrid,
  createAdaptiveField,
  createAdaptiveTopology,
  gridPosition,
  putChannel,
  rectangle,
  spatial,
  type Position,
} from "@atlas/domain";
import { landscape, configuration, invoke, options, registry } from "./mapFixtures";
import { culturalProcess, politicalProcess } from "./mapPeople";
import { MapRunner } from "./mapRunner";

it.each([384, 768])(
  "finishes cultures and politics on a narrow island at %i samples per side",
  async (size) => {
    const state = landscape();
    state.domain.world.id = state.domain.scope.worldId = "bc07dcd0-7cba-46b1-8e56-5f7829dde8cb";
    const footprint = rectangle([0, 0, 100000, 10000]);
    state.domain.scope.footprint = footprint;
    state.domain.world.reference.domain = footprint;
    state.domain.world.areas.area.footprint = footprint;
    state.surface = createGrid("narrow-island", state.domain.scope, size, size);
    putChannel(
      state.surface,
      "elevation",
      "metre",
      Float64Array.from(state.surface.active, (_, i) => {
        const p = gridPosition(state.surface, i);
        return p.x > 40000 && p.x < 60000 ? 100 : -10;
      })
    );
    const events: string[] = [];
    const started = performance.now();
    const result = await new MapRunner(
      configuration([invoke(culturalProcess), invoke(politicalProcess)]),
      registry(culturalProcess, politicalProcess)
    ).run(state, { ...options, progress: (_path, _fraction, message) => events.push(message) });
    console.log(
      `Narrow island cultures and politics: ${Math.round(performance.now() - started)} ms`
    );
    expect(
      Object.values(result.state.domain.world.entities)
        .map((entity) => entity.kind)
        .sort()
    ).toEqual(["culture", "language", "people", "polity", "religion"]);
    const sovereignty = Object.values(result.state.domain.world.features).find(
      (feature) => feature.kind === "sovereignty"
    )!;
    expect(spatial.area(sovereignty.geometry)).toBeGreaterThan(0);
    expect(events).toContain("Completed human.politics");
    expect(events.indexOf("Starting human.politics")).toBeGreaterThan(
      events.indexOf("Completed human.cultures")
    );
    expect(events).toContain("Validating completed geography");
  },
  180000
);

it("dissolves territory strips while preserving coastal holes and disconnected islands", async () => {
  const state = landscape();
  state.domain.world.id = state.domain.scope.worldId = "bc07dcd0-7cba-46b1-8e56-5f7829dde8cb";
  state.surface = createGrid("islands", state.domain.scope, 48, 48);
  putChannel(
    state.surface,
    "elevation",
    "metre",
    Float64Array.from(state.surface.active, (_, i) => {
      const x = i % 48,
        y = Math.floor(i / 48);
      return (x < 20 && !(x > 5 && x < 13 && y > 12 && y < 30)) || (x > 30 && y % 3 !== 0)
        ? 100
        : -10;
    })
  );
  const result = await new MapRunner(
    configuration([invoke(politicalProcess)], { polityCount: 1 }),
    registry(politicalProcess)
  ).run(state, options);
  const geometry = Object.values(result.state.domain.world.features).find(
    (feature) => feature.kind === "sovereignty"
  )!.geometry;
  const contains = spatial.pointCoverage(geometry);
  for (const [i, value] of state.surface.channels.elevation.entries())
    expect(contains(gridPosition(state.surface, i))).toBe(value > 0);
  expect(geometry.type).toBe("MultiPolygon");
});

it("preserves cultural distributions and political territories on adaptive world terrain", async () => {
  const state = landscape();
  state.domain.world.id = state.domain.scope.worldId = "bc07dcd0-7cba-46b1-8e56-5f7829dde8cb";
  const topology = createAdaptiveTopology([0, 0, 4000, 1000], {
    maximumSize: 250,
    minimumSize: 62.5,
    refine: ([x, y, right, top]) => x < 2200 && right > 1800 && y < 800 && top > 200,
  });
  state.surface = createAdaptiveField("adaptive-world", state.domain.scope, topology);
  putChannel(
    state.surface,
    "elevation",
    "metre",
    Float64Array.from(state.surface.active, (_, i) => {
      const p = gridPosition(state.surface, i);
      return 200 - Math.abs(p.y - 500) / 2;
    })
  );
  const result = await new MapRunner(
    configuration([invoke(culturalProcess), invoke(politicalProcess)], {
      cultureCount: 3,
      polityCount: 3,
    }),
    registry(culturalProcess, politicalProcess)
  ).run(state, options);
  expect(
    Object.keys(result.state.surface.channels).filter((channel) => channel.startsWith("culture:"))
  ).toHaveLength(3);
  const territories = Object.values(result.state.domain.world.features).filter(
    (feature) => feature.kind === "sovereignty"
  );
  expect(territories).toHaveLength(3);
  for (const territory of territories) {
    expect(spatial.area(territory.geometry)).toBeGreaterThan(0);
    expect(spatial.covers(state.surface.scope.footprint, territory.geometry)).toBe(true);
  }
});

it.each([1, 3])(
  "closes %i political boundaries when numerical terrain extends beyond the world's footprint",
  async (count) => {
    const state = landscape();
    state.domain.world.id = state.domain.scope.worldId = "bc07dcd0-7cba-46b1-8e56-5f7829dde8cb";
    const footprint = rectangle([0, 0, 1000, 1000]);
    state.domain.scope.footprint = footprint;
    state.domain.world.reference.domain = footprint;
    state.domain.world.areas.area.footprint = footprint;
    const topology = createAdaptiveTopology([-1000, -1000, 2000, 2000], {
      maximumSize: 125,
      minimumSize: 125,
    });
    state.surface = createAdaptiveField("terrain-with-halo", state.domain.scope, topology);
    putChannel(
      state.surface,
      "elevation",
      "metre",
      new Float64Array(topology.leaves.length).fill(100)
    );
    const result = await new MapRunner(
      configuration([invoke(politicalProcess)], { polityCount: count }),
      registry(politicalProcess)
    ).run(state, options);
    const territories = Object.values(result.state.domain.world.features).filter(
      (feature) => feature.kind === "sovereignty"
    );
    expect(territories).toHaveLength(count);
    if (count === 1) expect(spatial.area(territories[0].geometry)).toBeCloseTo(1_000_000, 0);
    for (const territory of territories) {
      expect(spatial.covers(footprint, territory.geometry)).toBe(true);
      const polity = result.state.domain.world.entities[territory.relations[0].targetId];
      expect(spatial.pointCoverage(territory.geometry)(polity.attributes.center as Position)).toBe(
        true
      );
    }
  }
);
