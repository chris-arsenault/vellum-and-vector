import { expect, it } from "vitest";
import {
  createGrid,
  population,
  putChannel,
  rectangle,
  residentBand,
  withPracticeShares,
} from "@atlas/domain";
import { landscape, epoch } from "./mapFixtures";
import type { MapProcessContext } from "./process";
import { initializePopulation, migratePopulation } from "./societyPopulation";
import { initializePolitics, evolvePolitics } from "./societyPolitics";
import { practiceAffinity, seekingFactor } from "./societySeeking";

function fixture(parameters: MapProcessContext["parameters"] = {}) {
  const state = landscape();
  state.domain.world.areas.area.profile = "region";
  state.domain.world.id = state.domain.scope.worldId = "bc07dcd0-7cba-46b1-8e56-5f7829dde8cb";
  state.domain.scope.footprint = rectangle([0, 0, 300000, 100000]);
  state.domain.world.areas.area.footprint = state.domain.scope.footprint;
  state.surface = createGrid("society", state.domain.scope, 13, 5);
  putChannel(
    state.surface,
    "elevation",
    "metre",
    residentBand("float64", new Float64Array(65).fill(100))
  );
  const context: MapProcessContext = {
    scope: state.domain.scope,
    invocation: [],
    parameters,
    epochs: [epoch("Arrival", 200, { mobility: 1, politicalCapacity: 1 })],
    epochIndices: [0],
    causes: [],
    recordCause() {},
    random: () => 0.5,
    cancelled: () => false,
    progress() {},
  };
  return { state, context };
}
const support = (farming: number, fishing: number) => ({
  farming,
  grazing: 0,
  gathering: 0,
  fishing,
  water: 1,
  capacity: farming + fishing,
});

it("weighs a destination by how far a people's practices find their medium there", () => {
  expect(practiceAffinity({}, { fishing: 1 })).toBe(0.5);
  expect(practiceAffinity({ fishing: 1 }, { fishing: 1 })).toBe(1);
  expect(practiceAffinity({ fishing: 1 }, { farming: 1 })).toBe(0);
  expect(practiceAffinity({ fishing: 0.5, farming: 0.5 }, { farming: 0.8, fishing: 0.2 })).toBe(
    0.5
  );
  expect(practiceAffinity({ "fire-forge": 1 }, { "fire-forge": 0.4, farming: 1 })).toBeCloseTo(0.4);
  expect(seekingFactor({}, {})).toBe(1);
  expect(seekingFactor({ fishing: 1 }, { fishing: 1 })).toBe(1.5);
});

it("sends more of a fishing people to the coast than to equally roomy farmland", () => {
  const { state, context } = fixture();
  initializePopulation(state, context);
  const region = state.society!.region,
    [a, b, c] = region.communities;
  expect(c).toBeDefined();
  a.groups = a.groups.map((g) => withPracticeShares({ ...g, count: 1000 }, { fishing: 1 }));
  b.groups = [];
  c.groups = [];
  a.support = support(5, 5);
  b.support = support(0, 10000);
  c.support = support(10000, 0);
  region.connections = [
    { from: a.id, to: b.id, distance: 50000, travelCost: 50000, kind: "land" },
    { from: a.id, to: c.id, distance: 50000, travelCost: 50000, kind: "land" },
  ];
  const moved = migratePopulation(state, 100, 1);
  expect(moved).toBeGreaterThan(0);
  expect(population(b)).toBeCloseTo(population(c) * 3, 6);
  expect(population(a) + population(b) + population(c)).toBeCloseTo(1000, 6);
});

it("extends a seat's control over the country its people know how to hold", () => {
  const { state, context } = fixture({ polityCount: 1 });
  initializePolitics(state, context);
  const region = state.society!.region,
    politics = region.politics!,
    polity = politics.polities[0];
  const seat = region.communities.find((c) => c.id === polity.seat)!,
    others = region.communities.filter((c) => c !== seat),
    [farmland, coast] = others;
  for (const c of region.communities) {
    c.groups[0].count = 1000;
    c.support = support(2000, 0);
  }
  seat.groups = seat.groups.map((g) => withPracticeShares(g, { farming: 1 }));
  coast.support = support(0, 2000);
  // At this cost an indifferent seat would hold neither; knowing the country decides.
  const travelCost = 250000 * Math.log(1 / 0.15);
  region.connections = [
    { from: seat.id, to: farmland.id, distance: travelCost, travelCost, kind: "land" },
    { from: seat.id, to: coast.id, distance: travelCost, travelCost, kind: "land" },
  ];
  evolvePolitics(state, context, 10);
  expect(politics.control[farmland.id]).toBe(polity.id);
  expect(politics.control[coast.id]).toBeUndefined();
});
