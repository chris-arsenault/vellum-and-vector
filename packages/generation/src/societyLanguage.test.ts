import { expect, it } from "vitest";
import {
  languageUse,
  languageKnowledge,
  languageShares,
  mergePopulation,
  populationGroupsSchema,
  storableValue,
  putChannel,
  everySample,
  residentBand,
  type PopulationGroup,
} from "@atlas/domain";
import { landscape } from "./mapFixtures";
import { initializePopulation } from "./societyPopulation";
import { initializeCultures } from "./societyCulture";
import { publishCultures } from "./societyCulturePublication";
import type { MapProcessContext } from "./process";

export function languageFixture() {
  const state = landscape();
  state.domain.world.id = "bc07dcd0-7cba-46b1-8e56-5f7829dde8cb";
  state.domain.world.areas.area.profile = "local";
  putChannel(
    state.surface,
    "elevation",
    "metre",
    residentBand("float64", new Float64Array(10).fill(100))
  );
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
  expect(state.surface.channels["language:A"].get(0)).toBe(1);
  expect(state.surface.channels["language:B"].get(0)).toBe(1);
  expect(state.surface.channels["languageUse:A"].get(0)).toBe(0.75);
  expect(state.surface.channels["languageUse:B"].get(0)).toBe(0.25);
  const merged = mergePopulation(region.communities[0].groups);
  expect(merged).toHaveLength(1);
  expect(languageUse(merged)).toEqual({ A: 0.75, B: 0.25 });
  expect(languageKnowledge(merged)).toEqual({ A: 1, B: 1 });
  region.communities[0].groups = [];
  publishCultures(state);
  expect(everySample(state.surface.channels["languageUse:A"], (n) => n === 0)).toBe(true);
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
  expect(state.surface.channels["language:A"].get(0)).toBe(1);
  expect(state.surface.channels["language:B"].get(0)).toBe(0.4);
  expect(state.surface.channels["languageUse:B"].get(0)).toBe(0.25);
});

it("derives a group's naming language from its languages and rejects an unknown one", () => {
  expect(
    populationGroupsSchema.parse([{ ...group("B"), languages: ["A", "B"] }])[0].namingLanguage
  ).toBe("B");
  expect(() =>
    populationGroupsSchema.parse([{ ...group("B"), namingLanguage: "unknown" }])
  ).toThrow("known languages");
});
