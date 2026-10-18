import { expect, it } from "vitest";
import { createGrid, gridPosition, putChannel, rectangle, spatial } from "@atlas/domain";
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
    ).toEqual(["culture", "polity"]);
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
