import { expect, it } from "vitest";
import {
  builtinLayers,
  rectangle,
  putChannel,
  isSocietyWork,
  type SocietyCommunity,
  type Entity,
} from "@atlas/domain";
import { landscape } from "./mapFixtures";
import type { MapProcessContext } from "./process";
import { communityName, finalizeNamesProcess, namePolity } from "./societyNaming";
import { generatedFeature } from "./mapFeatures";
import { executeProcessBehavior } from "./processTraits";
import { evolveSettlements } from "./societySettlements";
import { emptySupport } from "./societySupport";
import { makeWork } from "./societyWorks";
import { publishSocietyWorks } from "./societyWorkPublication";
import { workTerms } from "./namingCultures";

function fixture() {
  const state = landscape(),
    world = state.domain.world;
  world.areas.area.profile = "region";
  world.id = "bc07dcd0-7cba-46b1-8e56-5f7829dde8cb";
  world.layers = Object.fromEntries(builtinLayers().map((layer) => [layer.id, layer]));
  putChannel(state.surface, "elevation", "metre", new Float64Array(10).fill(100));
  const communities: SocietyCommunity[] = ["B", "C"].map((language, i) => ({
    id: `community-${i}`,
    name: "Provisional",
    position: { x: 1000 + i * 2000, y: 500, z: 0 },
    areaKm2: 2,
    groups: [
      {
        people: "people",
        culture: "old-culture",
        languages: [language],
        namingLanguage: language,
        religions: [],
        practices: [],
        count: 10000,
      },
    ],
    support: { ...emptySupport(), capacity: 10000, farming: 10000, water: 1 },
    founded: "",
    status: "abandoned",
    protected: false,
    causes: [],
    footprint: rectangle([i * 2000, 0, (i + 1) * 2000, 1000]),
  }));
  const region = {
    areaId: "area",
    spaceId: "surface",
    communities,
    connections: [],
    history: [],
    works: [],
    events: [],
    magic: [],
  };
  state.society = {
    region,
    owner: new Int32Array(10).fill(0),
    edges: [],
    river: new Float64Array(10),
    inherited: false,
    changed: new Set(),
  };
  for (const [id, culture] of [
    ["B", "costa"],
    ["C", "isles"],
  ])
    world.entities[id] = {
      id,
      kind: "language",
      name: id,
      state: "generated",
      relations: [],
      attributes: { namingCulture: culture },
    };
  const context: MapProcessContext = {
    scope: state.domain.scope,
    invocation: [],
    parameters: {},
    epochs: [{ id: "Arrival", duration: 100, parentEpoch: null, variables: {} }],
    epochIndices: [0],
    causes: [],
    recordCause() {},
    progress() {},
    random: () => 0.5,
    cancelled: () => false,
  };
  return { state, world, communities, context };
}
it("names new settlements from actual founding language and retains names as use changes", () => {
  const { state, world, communities, context } = fixture();
  evolveSettlements(state, context, 100);
  const c = communities[0],
    first = c.name,
    provenance = structuredClone(c.naming);
  expect(c.naming).toEqual({ language: "B", culture: "costa", era: "Arrival, year 100" });
  expect(first).toBe(communityName(world, c, c.founded).name);
  c.groups = structuredClone(communities[1].groups);
  evolveSettlements(state, context, 100);
  expect(c.name).toBe(first);
  expect(c.naming).toEqual(provenance);
  expect(c.history!.at(-1)!.languageUse).toEqual({ C: 1 });
});
it("resolves final biome names from regional language use and keeps established names", async () => {
  const { state, world, context } = fixture(),
    original = structuredClone(state.domain);
  const features = state.society!.region.communities.map((c, i) =>
    generatedFeature(state, `forest-${i}`, "Forest", "forest", "ecology", c.footprint!, {
      biome: "Boreal forest",
    })
  );
  for (const f of features) world.features[f.id] = f;
  await executeProcessBehavior(finalizeNamesProcess(original), state, context);
  expect(features.map((f) => f.attributes.namingLanguage)).toEqual(["B", "C"]);
  expect(features.map((f) => f.attributes.namingCulture)).toEqual(["costa", "isles"]);
  expect(features.every((f) => f.name.endsWith(" Boreal Forest"))).toBe(true);
  const names = features.map((f) => f.name);
  state.society!.region.communities.reverse();
  await executeProcessBehavior(finalizeNamesProcess(original), state, context);
  expect(features.map((f) => f.name)).toEqual(names);
});
it("keeps source and protected names even when they lack naming metadata", async () => {
  const { state, world, context } = fixture();
  const source = generatedFeature(
    state,
    "old",
    "Original",
    "forest",
    "ecology",
    rectangle([0, 0, 1500, 1000]),
    { biome: "Temperate forest" }
  );
  source.name = "The Ancient Wood";
  world.features[source.id] = source;
  const original = structuredClone(state.domain);
  const protectedFeature = generatedFeature(
    state,
    "protected",
    "Protected",
    "forest",
    "ecology",
    rectangle([2000, 0, 4000, 1000]),
    { biome: "Boreal forest" }
  );
  protectedFeature.protected = true;
  protectedFeature.name = "Creator's Forest";
  world.features[protectedFeature.id] = protectedFeature;
  await executeProcessBehavior(finalizeNamesProcess(original), state, context);
  expect(source.name).toBe("The Ancient Wood");
  expect(protectedFeature.name).toBe("Creator's Forest");
});
it("names seas from coastal speakers and leaves empty regions without fictional language use", async () => {
  const { state, world, communities, context } = fixture(),
    original = structuredClone(state.domain);
  communities[0].footprint = rectangle([0, 300, 2000, 1000]);
  communities[1].groups = [];
  const ocean = generatedFeature(
    state,
    "sea",
    "Ocean",
    "ocean",
    "oceans",
    rectangle([0, 0, 4000, 300])
  );
  const empty = generatedFeature(
    state,
    "empty",
    "Forest",
    "forest",
    "ecology",
    rectangle([3000, 500, 4000, 1000]),
    { biome: "Temperate forest" }
  );
  world.features[ocean.id] = ocean;
  world.features[empty.id] = empty;
  await executeProcessBehavior(finalizeNamesProcess(original), state, context);
  expect(ocean.attributes.namingLanguage).toBe("B");
  expect(ocean.attributes.namingCulture).toBe("costa");
  expect(empty.attributes.namingLanguage).toBeNull();
});
it("gives a polity its seat's naming language without replacing other communities' languages", () => {
  const { world, communities } = fixture();
  const polity: Entity = {
    id: "polity",
    kind: "polity",
    name: "Provisional",
    state: "generated",
    relations: [],
    attributes: {},
  };
  const before = structuredClone(communities);
  namePolity(world, polity, communities[0], "Founding");
  expect(polity.attributes.namingLanguage).toBe("B");
  expect(polity.attributes.namingCulture).toBe("costa");
  expect(communities).toEqual(before);
  const established = polity.name;
  namePolity(world, polity, communities[1], "Conquest");
  expect(polity.name).toBe(established);
});
it("names works at construction with varied functional terms and preserves their historical names", () => {
  const { state, world, communities } = fixture(),
    community = communities[0];
  world.areas.area.profile = "region";
  const works = Object.keys(workTerms).map((kind) =>
    makeWork(state, community, kind as keyof typeof workTerms)
  );
  state.society!.region.works = works;
  publishSocietyWorks(state);
  const before = works.map((work) => work.name);
  for (const work of works) {
    const feature = Object.values(world.features).find((f) => f.attributes.workId === work.id)!;
    expect(feature.name).toBe(work.name);
    expect(feature.name).not.toContain(" at ");
    expect(workTerms[work.kind].split("|").some((term) => feature.name.endsWith(` ${term}`))).toBe(
      true
    );
    expect(feature.attributes).toMatchObject({
      workKind: work.kind,
      namingKind: "societyWork",
      namingLanguage: "B",
      namingCulture: "costa",
      namedInEra: work.built,
    });
  }
  community.groups = structuredClone(communities[1].groups);
  community.name = "A different settlement name";
  publishSocietyWorks(state);
  expect(works.map((work) => work.name)).toEqual(before);
  expect(
    Object.values(world.features)
      .filter(isSocietyWork)
      .map((f) => f.name)
  ).toEqual(before);
});
it("retains existing work names and naming provenance when republishing", () => {
  const { state, world, communities } = fixture();
  world.areas.area.profile = "region";
  const work = makeWork(state, communities[0], "fire-forge");
  state.society!.region.works = [work];
  publishSocietyWorks(state);
  const feature = Object.values(world.features)[0];
  feature.name = "Old Ember Smithy";
  feature.attributes.namingLanguage = "older-language";
  work.name = "Another candidate name";
  publishSocietyWorks(state);
  expect(world.features[feature.id].name).toBe("Old Ember Smithy");
  expect(world.features[feature.id].attributes.namingLanguage).toBe("older-language");
});
