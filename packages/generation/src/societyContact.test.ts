import { expect, it } from "vitest";
import { putChannel, residentBand, type PopulationGroup } from "@atlas/domain";
import { landscape } from "./mapFixtures";
import type { MapProcessContext } from "./process";
import { supplySociety } from "./societyTestFixture";
import { communityReach, contactCosts, languageOverlap } from "./societyContact";

const speaker = (language: string): PopulationGroup => ({
  people: "residents",
  culture: "culture",
  languages: [language],
  namingLanguage: language,
  religions: [],
  practices: [],
  count: 1000,
});
const bilingual = (use: number): PopulationGroup => ({
  ...speaker("A"),
  languages: ["A", "B"],
  languageShares: { A: { knowledge: 1, use }, B: { knowledge: 1, use: 1 - use } },
});
/** Three communities: the first linked to the other two at equal cost, each with one language. */
function fixture() {
  const state = landscape();
  state.domain.world.id = "bc07dcd0-7cba-46b1-8e56-5f7829dde8cb";
  state.domain.world.areas.area.profile = "local";
  putChannel(
    state.surface,
    "Elevation",
    "native-length",
    residentBand("float64", new Float64Array(10).fill(102400))
  );
  const context: MapProcessContext = {
    scope: state.domain.scope,
    invocation: [],
    parameters: {},
    epochs: [{ id: "Contact", duration: 200, parentEpoch: null, variables: { mobility: 1 } }],
    epochIndices: [0],
    causes: [],
    recordCause() {},
    progress() {},
    random: () => 0.5,
    cancelled: () => false,
  };
  supplySociety(state);
  const region = state.society!.region;
  region.communities = region.communities.slice(0, 3);
  state.society!.owner.fill(0);
  for (const [i, c] of region.communities.entries()) c.groups = [speaker(["A", "B", "C"][i])];
  const [a, b, c] = region.communities;
  region.connections = [b, c].map((neighbor) => ({
    from: a.id,
    to: neighbor.id,
    travelCost: 1000,
    distance: 1000,
    kind: "land",
  }));
  return { state, context, region };
}

it("shortens a connection by the language its two ends share", () => {
  expect(languageOverlap({ A: 1, B: 0.4 }, { B: 1 })).toBe(0.4);
  expect(languageOverlap({ A: 1 }, { B: 1 })).toBe(0);
  expect(languageOverlap({ A: 1, B: 1 }, { A: 1, B: 1 })).toBe(1);
  const { region } = fixture(),
    [a, b, c] = region.communities,
    [toB, toC] = region.connections;
  const plain = contactCosts(region);
  expect(plain(toB)).toBe(1000);
  a.groups = [bilingual(0.5)];
  const shared = contactCosts(region);
  expect(shared(toB)).toBeCloseTo(1000 / 1.5, 9);
  expect(shared(toC)).toBe(1000);
  const reach = communityReach(region, 0);
  expect(reach[region.communities.indexOf(b)]).toBeLessThan(reach[region.communities.indexOf(c)]);
});
