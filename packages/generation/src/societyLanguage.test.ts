import { expect, it } from "vitest";
import {
  languageUse,
  languageKnowledge,
  languageShares,
  mergePopulation,
  population,
  populationGroupsSchema,
  storableValue,
  putChannel,
  type PopulationGroup,
} from "@atlas/domain";
import { landscape } from "./mapFixtures";
import { initializePopulation, migratePopulation } from "./societyPopulation";
import { initializeCultures } from "./societyCulture";
import { evolveLanguageUse } from "./societyLanguage";
import { publishCultures } from "./societyCulturePublication";
import type { MapProcessContext } from "./process";

export function languageFixture() {
  const state = landscape();
  state.domain.world.id = "bc07dcd0-7cba-46b1-8e56-5f7829dde8cb";
  state.domain.world.areas.area.profile = "local";
  putChannel(state.surface, "elevation", "metre", new Float64Array(10).fill(100));
  const context: MapProcessContext = {
    scope: state.domain.scope,
    invocation: [],
    parameters: { cultureCount: 2 },
    epochs: [{ id: "Contact", duration: 200, parentEpoch: null, variables: { mobility: 1 } }],
    epochIndices: [0],
    causes: [],
    recordCause() {},
    progress() {},
    random: () => 0.5,
    cancelled: () => false,
  };
  initializePopulation(state, context);
  const region = state.society!.region;
  region.communities = region.communities.slice(0, 3);
  state.society!.owner.fill(0);
  for (const [i, c] of region.communities.entries()) c.groups = [group(["A", "B", "C"][i])];
  const [a, b, c] = region.communities;
  region.connections = [b, c].map((neighbor) => ({
    from: a.id,
    to: neighbor.id,
    travelCost: 1000,
    distance: 1000,
    kind: "land",
  }));
  for (const [id, style] of [
    ["A", "marches"],
    ["B", "costa"],
    ["C", "isles"],
  ])
    state.domain.world.entities[id] = {
      id,
      kind: "language",
      name: id,
      state: "generated",
      relations: [],
      attributes: { namingCulture: style },
    };
  return { state, context, region };
}
function group(language: string, count = 1000): PopulationGroup {
  return {
    people: "people",
    culture: "culture",
    languages: [language],
    namingLanguage: language,
    religions: [],
    practices: [],
    count,
  };
}
it("initializes explicit language use and connects languages to the single atlas config", () => {
  const { state, context, region } = languageFixture();
  for (const c of region.communities)
    c.groups = [
      {
        ...group("A"),
        culture: null,
        languageShares: { A: { knowledge: 1, use: 1 } },
      },
    ];
  initializeCultures(state, context);
  for (const c of region.communities) {
    const problems: string[] = [];
    storableValue({ groups: c.groups }, "", problems);
    expect(problems).toEqual([]);
    for (const g of c.groups) {
      expect(g.languages).toContain(g.namingLanguage);
      expect(languageShares(g)).toEqual({ [g.namingLanguage!]: { knowledge: 1, use: 1 } });
      const language = state.domain.world.entities[g.namingLanguage!];
      expect(language.kind).toBe("language");
      expect(language.attributes.namingCulture).toBe(
        state.domain.world.entities[g.culture!].attributes.namingCulture
      );
    }
  }
});
it("publishes exclusive use alongside overlapping bilingual knowledge", () => {
  const { state, region } = languageFixture();
  region.communities[0].groups = [
    { ...group("A", 750), languages: ["A", "B"] },
    { ...group("B", 250), languages: ["A", "B"] },
  ];
  publishCultures(state);
  expect(state.surface.channels["language:A"][0]).toBe(1);
  expect(state.surface.channels["language:B"][0]).toBe(1);
  expect(state.surface.channels["languageUse:A"][0]).toBe(0.75);
  expect(state.surface.channels["languageUse:B"][0]).toBe(0.25);
  const merged = mergePopulation(region.communities[0].groups);
  expect(merged).toHaveLength(1);
  expect(languageUse(merged)).toEqual({ A: 0.75, B: 0.25 });
  expect(languageKnowledge(merged)).toEqual({ A: 1, B: 1 });
  region.communities[0].groups = [];
  publishCultures(state);
  expect(state.surface.channels["languageUse:A"].every((n) => n === 0)).toBe(true);
});
it("learns naming usage from multiple connected neighbors without moving people or erasing knowledge", () => {
  const { state, context, region } = languageFixture();
  const [a, b, c] = region.communities;
  b.protected = c.protected = true;
  for (let i = 0; i < 20; i++) evolveLanguageUse(state, context, 10);
  const use = languageUse(a.groups);
  expect(use.B).toBeGreaterThan(0);
  expect(use.C).toBeGreaterThan(0);
  expect(use.A).toBeGreaterThan(0);
  expect(Object.values(use).reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 12);
  expect(population(a)).toBeCloseTo(1000, 9);
  expect(a.groups.every((g) => g.languages.includes("A"))).toBe(true);
  expect(a.groups.every((g) => g.culture === "culture")).toBe(true);
  expect(a.groups).toHaveLength(1);
  expect(languageKnowledge(a.groups).A).toBe(1);
  expect(languageKnowledge(a.groups).B).toBeLessThan(1);
  expect(b.groups).toEqual([group("B")]);
});

it("publishes partial knowledge without counting everyone as a speaker", () => {
  const { state, region } = languageFixture();
  region.communities[0].groups = [
    {
      ...group("A"),
      languages: ["A", "B"],
      languageShares: { A: { knowledge: 1, use: 0.75 }, B: { knowledge: 0.4, use: 0.25 } },
    },
  ];
  publishCultures(state);
  expect(state.surface.channels["language:A"][0]).toBe(1);
  expect(state.surface.channels["language:B"][0]).toBe(0.4);
  expect(state.surface.channels["languageUse:B"][0]).toBe(0.25);
});

it("migration conserves both mixed naming use and overlapping language knowledge", () => {
  const { state, region } = languageFixture();
  const [a, b] = region.communities;
  region.connections = [region.connections[0]];
  a.groups = [
    {
      ...group("A"),
      languages: ["A", "B"],
      languageShares: { A: { knowledge: 1, use: 0.75 }, B: { knowledge: 0.4, use: 0.25 } },
    },
  ];
  a.support.capacity = 1;
  b.support.capacity = 1_000_000;
  const before = structuredClone(region.communities.flatMap((c) => c.groups));
  const total = before.reduce((sum, g) => sum + g.count, 0);
  migratePopulation(state, 100, 1);
  const after = region.communities.flatMap((c) => c.groups);
  expect(languageUse(b.groups).A).toBeGreaterThan(0);
  expect(after.reduce((sum, g) => sum + g.count, 0)).toBeCloseTo(total, 9);
  for (const aggregate of [languageUse, languageKnowledge]) {
    for (const [id, share] of Object.entries(aggregate(before)))
      expect(aggregate(after)[id] * total).toBeCloseTo(share * total, 9);
  }
});

it("keeps many-language contact proportional to languages rather than their combinations", () => {
  const { state, context, region } = languageFixture();
  const home = region.communities[0];
  const neighbors = Array.from({ length: 30 }, (_, i) => ({
    ...structuredClone(home),
    id: `neighbor-${i}`,
    protected: true,
    groups: [group(`L${i}`)],
  }));
  region.communities = [home, ...neighbors];
  region.connections = neighbors.map((c) => ({
    from: home.id,
    to: c.id,
    travelCost: 1000,
    distance: 1000,
    kind: "land",
  }));
  for (let cycle = 0; cycle < 20; cycle++) evolveLanguageUse(state, context, 10);
  expect(home.groups).toHaveLength(1);
  expect(Object.keys(languageShares(home.groups[0]))).toHaveLength(31);
  expect(population(home)).toBe(1000);
  expect(Object.values(languageUse(home.groups)).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  for (const share of Object.values(languageShares(home.groups[0]))) {
    expect(share.use).toBeLessThanOrEqual(share.knowledge);
    expect(share.knowledge).toBeLessThanOrEqual(1);
  }
  const first = structuredClone(home.groups);
  home.groups = [group("A")];
  for (let cycle = 0; cycle < 20; cycle++) evolveLanguageUse(state, context, 10);
  expect(home.groups).toEqual(first);
});

it("matches language marginals of the prior splitting rule for one contact step", () => {
  const { state, context, region } = languageFixture();
  const [home, neighbor] = region.communities;
  home.groups = [
    {
      ...group("A"),
      languages: ["A", "B"],
      languageShares: {
        A: { knowledge: 1, use: 0.8 },
        B: { knowledge: 0.4, use: 0.2 },
      },
    },
  ];
  neighbor.groups = [group("B")];
  region.connections = [region.connections[0]];
  const fraction = -Math.expm1((-10 * Math.exp(-1000 / 150000)) / 400);
  evolveLanguageUse(state, context, 10);
  const shares = languageShares(home.groups[0]);
  expect(shares.A.use).toBeCloseTo(0.8 * (1 - fraction), 12);
  expect(shares.B.use).toBeCloseTo(0.2 * (1 - fraction) + fraction, 12);
  expect(shares.B.knowledge).toBeCloseTo(0.4 + 0.6 * fraction, 12);
  expect(population(home)).toBe(1000);
});
it("respects disconnected geography, zero mobility and inherited history", () => {
  const { state, context, region } = languageFixture();
  const before = structuredClone(region.communities);
  evolveLanguageUse(
    state,
    { ...context, epochs: [{ ...context.epochs[0], variables: { mobility: 0 } }] },
    200
  );
  expect(region.communities.map((c) => languageUse(c.groups))).toEqual(
    before.map((c) => languageUse(c.groups))
  );
  region.connections = [];
  evolveLanguageUse(state, context, 200);
  expect(region.communities.map((c) => languageUse(c.groups))).toEqual(
    before.map((c) => languageUse(c.groups))
  );
  state.society!.inherited = true;
  region.connections = [
    { from: before[0].id, to: before[1].id, distance: 1, travelCost: 1, kind: "land" },
  ];
  evolveLanguageUse(state, context, 200);
  expect(region.communities.map((c) => languageUse(c.groups))).toEqual(
    before.map((c) => languageUse(c.groups))
  );
});
it("carries primary language with migrating people and preserves authored usage", () => {
  const { state, region } = languageFixture();
  const [a, b] = region.communities;
  region.connections = [region.connections[0]];
  a.support.capacity = 1;
  b.support.capacity = 1_000_000;
  const before = region.communities.reduce(
    (sum, c) => sum + population(c) * (languageUse(c.groups).A ?? 0),
    0
  );
  migratePopulation(state, 100, 1);
  expect(languageUse(b.groups).A).toBeGreaterThan(0);
  const after = region.communities.reduce(
    (sum, c) => sum + population(c) * (languageUse(c.groups).A ?? 0),
    0
  );
  expect(after).toBeCloseTo(before, 9);
  expect(
    populationGroupsSchema.parse([{ ...group("B"), languages: ["A", "B"] }])[0].namingLanguage
  ).toBe("B");
  expect(() =>
    populationGroupsSchema.parse([{ ...group("B"), namingLanguage: "unknown" }])
  ).toThrow("known languages");
});
