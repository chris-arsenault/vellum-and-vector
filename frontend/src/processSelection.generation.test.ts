import { expect, it } from "vitest";
import { generateAtlas, prepareAtlasGeneration, optionalProcesses } from "@atlas/generation";
import { createWorld, session } from "./atlasState";
import { generationSnapshot } from "./generationJobs";
import { createGrid, putChannel } from "@atlas/domain";

it("generates coherent fresh geography with optional effects omitted and retains its exact request", async () => {
  const world = createWorld({
    name: "Selected world",
    seed: 42,
    width: 3_000_000,
    height: 2_000_000,
  });
  world.epochs = [world.epochs[0]];
  const source = session(world.id).snapshot;
  const prepared = prepareAtlasGeneration(source, {
    areaId: source.scope.areaId,
    seed: 73,
    domains: ["physical", "cultural"],
    quality: "draft",
    processes: Object.fromEntries(Object.keys(optionalProcesses).map((id) => [id, false])),
  });
  expect(prepared.diagnostics).toEqual([]);
  const output = await generateAtlas(source, prepared.input);
  expect(output.state.surface.channels.elevation.every(Number.isFinite)).toBe(true);
  expect(output.state.surface.channels.impactExcavation).toBeUndefined();
  expect(output.state.surface.channels.volcanicConstruction).toBeUndefined();
  expect(output.state.surface.channels.biome).toBeUndefined();
  expect(output.state.surface.channels.floodplain).toBeUndefined();
  expect(output.state.history).toHaveLength(1);
  expect(
    Object.values(output.state.domain.world.features).some((feature) =>
      ["crater", "volcano", "forest"].includes(feature.kind)
    )
  ).toBe(false);
  const published = generationSnapshot(output, prepared.input, "selected-world");
  expect(published.world.fields.some((field) => field.layerId === "ecology")).toBe(false);
  expect(published.world.generations.at(-1)?.configuration).toEqual(prepared.input.configuration);
}, 120000);

it("applies present magic to authored terrain without inventing geological event histories", async () => {
  const world = createWorld({ name: "Authored terrain", seed: 73, width: 1000, height: 1000 });
  const source = session(world.id).snapshot;
  const id = crypto.randomUUID();
  const grid = createGrid(id, source.scope, 4, 4);
  putChannel(grid, "elevation", "metre", new Float64Array(16).fill(100));
  source.numerical[id] = grid;
  world.fields.push({
    id,
    areaId: source.scope.areaId,
    spaceId: source.scope.spaceId,
    layerId: "terrain",
    algorithm: "authored",
    source: { kind: "operation", id: crypto.randomUUID() },
    samples: 16,
    channels: ["elevation"],
  });
  const result = await generateAtlas(source, {
    areaId: source.scope.areaId,
    seed: 73,
    quality: "draft",
    domains: ["magic"],
  });
  expect(result.state.history).toEqual([]);
  expect(
    result.state.surface.channels.elevation.every((value) => Math.abs(value - 100) < 0.01)
  ).toBe(true);
  expect(result.state.surface.channels.impactExcavation).toBeUndefined();
}, 120000);
