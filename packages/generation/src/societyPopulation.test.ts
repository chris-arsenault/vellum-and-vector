import { expect, it } from "vitest";
import { builtinLayers, createGrid, population, putChannel, rectangle } from "@atlas/domain";
import { landscape, epoch, configuration, invoke, options, registry } from "./mapFixtures";
import {
  initializePopulation,
  evolvePopulation,
  migratePopulation,
  populationTotal,
} from "./societyPopulation";
import { populationInitialize, populationProcess, populationPublish } from "./societyProcesses";
import { MapRunner } from "./mapRunner";
import { publishSettlements } from "./societyPublication";
import type { MapProcessContext } from "./process";
import { generateAtlas } from "./atlasWorkflow";
import { publishGenerationProducts } from "./publication";
import { generatedFeature } from "./mapFeatures";

export function societyFixture() {
  const state = landscape();
  state.domain.world.id = state.domain.scope.worldId = "bc07dcd0-7cba-46b1-8e56-5f7829dde8cb";
  state.domain.world.layers = Object.fromEntries(builtinLayers().map((l) => [l.id, l]));
  state.domain.scope.footprint = rectangle([0, 0, 300000, 100000]);
  state.domain.world.areas.area.footprint = state.domain.scope.footprint;
  state.surface = createGrid("society", state.domain.scope, 13, 5);
  putChannel(state.surface, "elevation", "metre", new Float64Array(65).fill(100));
  const context: MapProcessContext = {
    scope: state.domain.scope,
    invocation: [],
    parameters: {},
    epochs: [epoch("Arrival", 200, { mobility: 1 })],
    epochIndices: [0],
    causes: [],
    recordCause() {},
    random: () => 0.5,
    cancelled: () => false,
    progress() {},
  };
  return { state, context };
}
it("accounts for population change and publishes communities from their people", () => {
  const { state, context } = societyFixture();
  initializePopulation(state, context);
  evolvePopulation(state, context, 200);
  const record = state.society!.region.history[0];
  expect(record.before + record.births - record.deaths).toBeCloseTo(record.after, 6);
  publishSettlements(state, context);
  const settlements = Object.values(state.domain.world.features).filter(
    (f) => f.kind === "settlement"
  );
  expect(settlements).toHaveLength(state.society!.region.communities.length);
  expect(settlements.reduce((sum, f) => sum + Number(f.attributes.population), 0)).toBeCloseTo(
    record.after,
    6
  );
});
it("transfers joint affiliations conservatively and leaves protected people fixed", () => {
  const { state, context } = societyFixture();
  initializePopulation(state, context);
  const [a, b] = state.society!.region.communities;
  state.society!.region.connections = [
    { from: a.id, to: b.id, distance: 10000, travelCost: 10000, kind: "land" },
  ];
  a.groups = [
    {
      people: "people",
      culture: "culture",
      languages: ["one", "two"],
      religions: ["faith"],
      practices: [],
      count: 1000,
    },
  ];
  b.groups = [];
  a.support.capacity = 10;
  b.support.capacity = 10000;
  const before = populationTotal(state);
  expect(migratePopulation(state, 100, 1)).toBeGreaterThan(0);
  expect(populationTotal(state)).toBeCloseTo(before, 8);
  expect(b.groups[0].languages).toEqual(["one", "two"]);
  a.protected = true;
  const fixed = population(a);
  migratePopulation(state, 100, 1);
  expect(population(a)).toBe(fixed);
});
it("does not connect communities across impassable water", () => {
  const { state, context } = societyFixture();
  for (let i = 0; i < 65; i++) if (i % 13 === 6) state.surface.channels.elevation[i] = -100;
  initializePopulation(state, context);
  const nodes = new Map(state.society!.region.communities.map((c) => [c.id, c]));
  for (const link of state.society!.region.connections) {
    expect(nodes.get(link.from)!.position.x < 150000).toBe(nodes.get(link.to)!.position.x < 150000);
  }
});
it("retains completed population history without advancing it on regeneration", () => {
  const { state, context } = societyFixture();
  initializePopulation(state, context);
  evolvePopulation(state, context, 200);
  const before = populationTotal(state);
  initializePopulation(state, context);
  evolvePopulation(state, context, 200);
  expect(populationTotal(state)).toBeCloseTo(before, 6);
  expect(state.society!.region.history).toHaveLength(1);
});
it("runs elapsed population through the common process runner deterministically", async () => {
  const { state } = societyFixture();
  const config = configuration([
    invoke(populationInitialize),
    {
      kind: "epochs",
      id: "eras",
      epochs: [epoch("Arrival", 200)],
      resetFacts: [],
      body: [invoke(populationProcess)],
    },
    invoke(populationPublish),
  ]);
  const run = () =>
    new MapRunner(config, registry(populationInitialize, populationProcess, populationPublish)).run(
      state,
      options
    );
  const first = await run(),
    second = await run();
  expect(first.state.domain.world.societies).toEqual(second.state.domain.world.societies);
  expect(first.state.surface.channels.populationDensity.some((n) => n > 0)).toBe(true);
});

it("honors an authored population before growth and migration", () => {
  const { state, context } = societyFixture();
  const feature = generatedFeature(
    state,
    "authored",
    "Home",
    "settlement",
    "settlements",
    { type: "Point", coordinates: [0, 0] },
    { population: 1234 }
  );
  feature.state = "authored";
  feature.protected = true;
  state.domain.world.features[feature.id] = feature;
  initializePopulation(state, context);
  evolvePopulation(state, context, 200);
  const home = state.society!.region.communities.find((c) => c.name === "Home")!;
  expect(population(home)).toBe(1234);
  expect(state.domain.world.features[feature.id]).toEqual(feature);
});

it.each([["built"], ["built", "cultural"]])(
  "publishes population and settlement products for %j",
  async (...domains) => {
    const { state } = societyFixture();
    const source = state.domain;
    source.world.epochs = [
      {
        id: "Landscape",
        duration: 1000,
        tectonics: 0,
        hydrology: 0,
        ice: 0,
        coasts: 0,
        temperature: 15,
        seaLevel: 0,
      },
    ];
    source.world.humanEras = [
      { id: "Arrival", years: 200, physicalEpoch: null, mobility: 1, politicalCapacity: 1 },
    ];
    source.world.fields.push({
      id: "terrain",
      areaId: "area",
      layerId: "elevation",
      algorithm: "test",
      source: { kind: "run", id: "prior" },
      samples: 65,
      channels: ["elevation"],
      resourceId: "terrain",
      state: "generated",
      footprint: source.scope.footprint,
      spaceId: "surface",
    });
    source.numerical.terrain = state.surface;
    const result = await generateAtlas(source, {
      areaId: "area",
      domains,
      quality: "draft",
      seed: 42,
    });
    publishGenerationProducts(result.state, "population-run", source);
    expect(result.state.domain.world.societies!.area.history).toHaveLength(1);
    expect(
      result.state.domain.world.fields.some((f) => f.channels?.includes("populationDensity"))
    ).toBe(true);
    expect(
      Object.values(result.state.domain.world.features).some(
        (f) => Number(f.attributes.population) > 0
      )
    ).toBe(true);
  },
  30000
);
