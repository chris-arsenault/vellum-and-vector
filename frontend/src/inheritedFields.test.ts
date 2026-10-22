import { expect, it } from "vitest";
import { createWorldSnapshot } from "./atlasState";
import { generateAtlas, publishGenerationProducts } from "@atlas/generation";
import { createGrid, putChannel, fieldInterpolator, rectangle } from "@atlas/domain";
import { numericTileSampler } from "./numericTiles";

function inheritedWorld() {
  const domain = createWorldSnapshot({
    name: "Inherited fields",
    seed: 42,
    width: 4000,
    height: 1000,
  });
  const grid = createGrid("height", domain.scope, 5, 2);
  putChannel(grid, "elevation", "metre", new Float64Array(10).fill(100));
  putChannel(grid, "culture:origin", "ratio", new Float64Array(10).fill(0.01));
  domain.world.entities.origin = {
    id: "origin",
    kind: "culture",
    name: "Culture",
    state: "generated",
    attributes: { center: { x: 2000, y: 500, z: 0 } },
    relations: [],
  };
  domain.world.fields = [
    {
      id: grid.id,
      areaId: domain.scope.areaId,
      layerId: "elevation",
      algorithm: "generation",
      source: { kind: "run", id: "inherited-fixture" },
      samples: 10,
      channels: Object.keys(grid.channels),
      resourceId: grid.id,
      state: "generated",
      footprint: grid.scope.footprint,
      spaceId: grid.scope.spaceId,
    },
  ];
  domain.numerical[grid.id] = grid;
  return { domain, grid };
}

it("replaces inherited culture prevalence in queries and published fields", async () => {
  const { domain } = inheritedWorld();
  const result = await generateAtlas(domain, {
    areaId: domain.scope.areaId,
    domains: ["cultural"],
    quality: "draft",
    seed: 42,
  });
  const grid = result.state.surface,
    channel = "culture:origin",
    p = { x: 2000, y: 500, z: 0 };
  expect(Math.max(...grid.channels[channel])).toBeGreaterThan(0.1);
  expect(fieldInterpolator(grid, channel)(p)).toBeGreaterThan(0.1);
  publishGenerationProducts(result.state, "culture-repair");
  const published = result.state.domain.world.fields.filter(
    (f) => f.layerId === "cultures" && f.channels?.includes(channel)
  );
  expect(published).toHaveLength(1);
  for (const field of published)
    expect(fieldInterpolator(result.state.domain.numerical[field.id], channel)(p)).toBeCloseTo(
      fieldInterpolator(grid, channel)(p),
      8
    );
});

it("renders inherited physical lakes without requiring lake vector publication", async () => {
  const { domain, grid } = inheritedWorld();
  for (const [name, value] of [
    ["water", 2],
    ["waterLevel", 200],
    ["seaLevel", 0],
  ] as const)
    putChannel(
      grid,
      name,
      name === "water" ? "category" : "metre",
      new Float64Array(10).fill(value)
    );
  domain.world.fields[0].channels = Object.keys(grid.channels);
  grid.reconstruction = {
    support: {
      x: Float64Array.from({ length: 10 }, (_, i) => (i % 5) * 1000),
      y: Float64Array.from({ length: 10 }, (_, i) => Math.floor(i / 5) * 1000),
      origin: [0, 0],
      spacing: 1000,
    },
    channels: { elevation: grid.channels.elevation },
    water: {
      elevation: grid.channels.elevation,
      bodyIds: new Float64Array(10).fill(1),
      seaLevel: 0,
      lakes: [{ id: 1, footprint: rectangle([1000, 200, 3000, 800]), level: 200 }],
    },
  };
  const result = await generateAtlas(domain, {
      areaId: domain.scope.areaId,
      domains: ["cultural"],
      quality: "draft",
      seed: 42,
    }),
    field = result.state.surface,
    tile = numericTileSampler({
      id: "terrain",
      areaId: domain.scope.areaId,
      field,
      water: field,
      channel: "elevation",
      footprint: field.scope.footprint,
      bounds: field.bounds,
      lakes: [],
    });
  for (const [x, expected] of [
    [2000, 2],
    [500, 0],
  ] as const) {
    const p = { x, y: 500, z: 0 },
      pixel = tile([x - 0.5, 499.5, x + 0.5, 500.5], 1);
    expect(fieldInterpolator(field, "water")(p)).toBe(expected);
    expect(pixel[3]).toBe(expected);
    expect(pixel[2]).toBe(expected === 2 ? -100 : 100);
  }
});
