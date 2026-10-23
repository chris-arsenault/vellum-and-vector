import { expect, it } from "vitest";
import { generate } from "@atlas/name-forge";
import { rectangle, builtinLayers, putChannel } from "@atlas/domain";
import { atlasName, geographicNamingCulture } from "./atlasNaming";
import {
  atlasNamingCultures,
  atlasNamingModels,
  atlasNamingKinds,
  namingSources,
} from "./namingCultures";
import { generatedFeature, putGenerated } from "./mapFeatures";
import { landscape } from "./mapFixtures";
import { extractOceans } from "./canonry/oceanFeatures";
import { initializePopulation } from "./societyPopulation";
import { initializeCultures } from "./societyCulture";
import { publishSettlements } from "./societyPublication";
import type { MapProcessContext } from "./process";

function fixture() {
  const state = landscape();
  state.domain.world.id = "2f6e0134-6017-4e80-9196-052a12218500";
  state.domain.world.layers = Object.fromEntries(builtinLayers().map((l) => [l.id, l]));
  return state;
}
it.each(atlasNamingCultures)(
  "generates new and recognizable place spellings for $name",
  (culture) => {
    const request = { kind: "settlement", seed: "name-sample-review", count: 200 };
    const result = generate(culture, request, { models: atlasNamingModels });
    expect(generate(culture, request, { models: atlasNamingModels })).toEqual(result);
    expect(result.strategyUsage.markov).toBeGreaterThan(result.strategyUsage.grammar);
    for (const name of result.names) {
      expect(name).toMatch(/^[A-Z][a-z]+(?: [A-Z][a-z]+)?$/);
      expect(name).not.toMatch(/\d|Name-|markov:|slot:/);
    }
    const training = new Set(
      namingSources
        .find((s) => s.id === culture.id)!
        .samples.toLowerCase()
        .split(/\s+/)
    );
    expect(result.names.some((name) => !training.has(name.toLowerCase()))).toBe(true);
  }
);
it("uses GIS naming profiles, biome subkinds and readable geographic descriptors", () => {
  const world = fixture().domain.world,
    position = { x: 1000, y: 500 };
  expect(atlasNamingKinds.biome).toContain("Boreal forest");
  for (const kind of ["ocean", "settlement", "polity", "river", "lake"] as const)
    expect(atlasName(world, { key: kind, kind, position }).namingKind).toBe(kind);
  const first = atlasName(world, {
    key: "forest",
    kind: "biome",
    subkind: "Boreal forest",
    position,
  });
  expect(first.name).toMatch(/ Boreal Forest$/);
  expect(first.namingSubkind).toBe("Boreal forest");
  expect(
    atlasName(world, { key: "forest", kind: "biome", subkind: "Boreal forest", position })
  ).toEqual(first);
});
it("names published biome regions without changing classification or feature identity", () => {
  const state = fixture(),
    shape = rectangle([100, 100, 2000, 900]);
  const f = generatedFeature(state, "forest:one", "Forest 1 2", "forest", "ecology", shape, {
    biome: "Temperate forest",
  });
  expect(f.name).toMatch(/ Temperate Forest$/);
  expect(f.attributes).toMatchObject({
    biome: "Temperate forest",
    namingKind: "biome",
    namingSubkind: "Temperate forest",
  });
  putGenerated(state, { ...f, name: "The Old Wood", state: "authored" });
  expect(putGenerated(state, { ...f, name: "Replacement" })).toBe(false);
  expect(state.domain.world.features[f.id].name).toBe("The Old Wood");
});
it("publishes named oceans from existing sea geometry and retains protected names", () => {
  const state = fixture();
  state.surface.ocean = rectangle([0, 0, 1000, 1000]);
  extractOceans(state);
  const ocean = Object.values(state.domain.world.features)[0];
  expect(ocean.kind).toBe("ocean");
  expect(ocean.layerId).toBe("oceans");
  expect(ocean.name).toMatch(/ Ocean$/);
  expect(ocean.geometry).toEqual(state.surface.ocean);
  ocean.protected = true;
  ocean.name = "Western Sea";
  extractOceans(state);
  expect(state.domain.world.features[ocean.id].name).toBe("Western Sea");
});
it("keeps naming cultures geographic and independent of generated feature iteration", () => {
  const world = fixture().domain.world,
    p = { x: 2000, y: 500 };
  const request = { key: "city", kind: "settlement" as const, position: p };
  const before = atlasName(world, request);
  atlasName(world, { ...request, key: "unrelated" });
  expect(atlasName(world, request)).toEqual(before);
  expect(geographicNamingCulture(world, p).id).toBe(before.namingCulture);
});
it("uses founding culture profiles for settlements and preserves authored community names", () => {
  const state = fixture();
  putChannel(state.surface, "elevation", "metre", new Float64Array(10).fill(100));
  const context: MapProcessContext = {
    scope: state.domain.scope,
    invocation: [],
    parameters: { cultureCount: 1 },
    inputs: {},
    epochs: [],
    epochIndices: [],
    causes: [],
    recordCause() {},
    progress() {},
    cancelled: () => false,
    random: () => 0.5,
  };
  initializePopulation(state, context);
  for (const community of state.society!.region.communities) {
    community.groups[0].count = 1000;
    community.founded = "Founders";
    community.status = "inhabited";
  }
  const c = state.society!.region.communities[0];
  c.name = "Creator's Landing";
  c.causes.push("Authored starting community creator-1.");
  initializeCultures(state, context);
  expect(c.name).toBe("Creator's Landing");
  for (const other of state.society!.region.communities.slice(1)) {
    const expected = atlasName(state.domain.world, {
      key: other.id,
      kind: "settlement",
      position: other.position,
      culture: other.groups[0].culture!,
    });
    expect(other.name).toBe(expected.name);
  }
  publishSettlements(state, context);
  expect(
    Object.values(state.domain.world.features).find((f) => f.attributes.communityId === c.id)?.name
  ).toBe(c.name);
});
