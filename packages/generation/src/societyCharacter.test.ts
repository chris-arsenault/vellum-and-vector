import { expect, it } from "vitest";
import {
  createGrid,
  isLivelihood,
  putChannel,
  rectangle,
  withPracticeShares,
  type PopulationGroup,
  type SocietyRegion,
} from "@atlas/domain";
import { landscape, epoch } from "./mapFixtures";
import type { MapProcessContext } from "./process";
import { polityCharacter, polityTerm, type PolityCharacter } from "./societyCharacter";
import { initializeCultures } from "./societyCulture";
import { evolveSociety } from "./societyEvolution";
import { finalizeNamesProcess } from "./societyNaming";
import { publishPolitics } from "./societyPoliticalPublication";
import { initializePolitics } from "./societyPolitics";

function group(count: number, languages: string[], shares: Record<string, number>) {
  const base: PopulationGroup = {
    people: "residents",
    culture: "culture",
    languages,
    religions: [],
    practices: [],
    count,
  };
  return withPracticeShares(base, shares);
}
function region(communities: SocietyRegion["communities"], control: Record<string, string>) {
  return {
    areaId: "area",
    spaceId: "surface",
    communities,
    connections: [],
    history: [],
    works: [],
    events: [],
    magic: [],
    politics: {
      polities: [{ id: "p", seat: "a", support: 1, status: "active", claims: [], causes: [] }],
      sovereignty: {},
      control,
      contested: {},
      history: [],
    },
  } satisfies SocietyRegion;
}
const community = (id: string, groups: PopulationGroup[]) =>
  ({
    id,
    name: id,
    position: { x: 0, y: 0, z: 0 },
    areaKm2: 1,
    groups,
    support: { farming: 0, grazing: 0, gathering: 0, fishing: 0, water: 0, capacity: 0 },
    founded: "x",
    status: "inhabited",
    protected: false,
    causes: [],
  }) satisfies SocietyRegion["communities"][number];

it("reads a polity's character from the communities it holds", () => {
  const r = region(
    [
      community("a", [group(300, ["A", "B"], { fishing: 0.9, farming: 0.1 })]),
      community("b", [group(100, ["C"], { fishing: 0.5, farming: 0.5, "fire-forge": 0.2 })]),
      community("c", [group(1000, ["D"], { farming: 1 })]),
    ],
    { a: "p", b: "p", c: "other" }
  );
  const character = polityCharacter(r, r.politics.polities[0]);
  expect(character.people).toBe(400);
  expect(character.communities).toBe(2);
  expect(character.practices.fishing).toBeCloseTo(0.8, 4);
  expect(character.practices["fire-forge"]).toBeCloseTo(0.05, 4);
  expect(character.languages).toBe(3);
  expect(polityTerm(character)).toBe("League");
});

it("ends a polity's name in the word its character earns", () => {
  const of = (practices: Record<string, number>, languages = 1): PolityCharacter => ({
    practices,
    languages,
    communities: 1,
    people: 1,
  });
  expect(polityTerm(of({ farming: 0.6, fishing: 0.4 }))).toBe("Commonwealth");
  expect(polityTerm(of({ grazing: 0.7 }))).toBe("Horde");
  expect(polityTerm(of({ gathering: 0.5, fishing: 0.5 }))).toBe("League");
  expect(polityTerm(of({ farming: 0.5, "fire-forge": 0.4 }))).toBe("Hold");
  expect(polityTerm(of({ farming: 0.4, fishing: 0.3, grazing: 0.3 }, 3))).toBe("Concord");
  expect(polityTerm(of({ farming: 0.4, fishing: 0.3, grazing: 0.3 }, 2))).toBe("Commonwealth");
  expect(polityTerm(of({}))).toBe("Commonwealth");
});

it("publishes each polity's character and names it from it after the eras run", async () => {
  const state = landscape();
  state.domain.world.areas.area.profile = "region";
  state.domain.world.id = state.domain.scope.worldId = "bc07dcd0-7cba-46b1-8e56-5f7829dde8cb";
  state.domain.scope.footprint = rectangle([0, 0, 300000, 100000]);
  state.domain.world.areas.area.footprint = state.domain.scope.footprint;
  state.surface = createGrid("society", state.domain.scope, 13, 5);
  putChannel(state.surface, "elevation", "metre", new Float64Array(65).fill(100));
  const original = structuredClone(state.domain);
  const context: MapProcessContext = {
    scope: state.domain.scope,
    invocation: [],
    parameters: { polityCount: 2, cultureCount: 2, cultural: true, political: true },
    epochs: [epoch("Settlement", 200, { mobility: 1, politicalCapacity: 1 })],
    epochIndices: [0],
    causes: [],
    recordCause() {},
    random: () => 0.5,
    cancelled: () => false,
    progress() {},
  };
  initializePolitics(state, context);
  for (const c of state.society!.region.communities) c.groups[0].count = 1000;
  initializeCultures(state, context);
  await evolveSociety(state, context, 200);
  publishPolitics(state);
  const finalize = finalizeNamesProcess(original);
  if (finalize.behavior.kind === "extract") finalize.behavior.extract(state, context);
  const region = state.society!.region;
  for (const polity of region.politics!.polities) {
    const entity = state.domain.world.entities[polity.id],
      character = entity.attributes.character as PolityCharacter;
    expect(character.communities).toBeGreaterThan(0);
    const livelihoods = Object.entries(character.practices)
      .filter(([id]) => isLivelihood(id))
      .reduce((sum, [, share]) => sum + share, 0);
    expect(livelihoods).toBeGreaterThan(0.5);
    expect(livelihoods).toBeLessThanOrEqual(1.001);
    expect(entity.name.endsWith(polityTerm(character))).toBe(true);
  }
  // Every community learned its livelihoods over the era.
  for (const c of region.communities)
    if (c.groups.length) expect(c.groups[0].practices.length).toBeGreaterThan(0);
});
