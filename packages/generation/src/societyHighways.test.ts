import { expect, it } from "vitest";
import { createGrid, putChannel, rectangle } from "@atlas/domain";
import { landscape, epoch } from "./mapFixtures";
import { randomStream } from "./random";
import type { MapProcessContext } from "./process";
import { initializePopulation } from "./societyPopulation";
import { refreshSocietySupport } from "./societyGeography";
import { raiseHighways } from "./societyHighways";
import { wayClass, wayClasses } from "./societyWays";

function fixture(trees: number) {
  const state = landscape();
  state.domain.world.id = "bc07dcd0-7cba-46b1-8e56-5f7829dde8cb";
  const footprint = rectangle([0, 0, 300000, 100000]);
  state.domain.scope.footprint = footprint;
  state.domain.world.areas.area.footprint = footprint;
  state.surface = createGrid("society", state.domain.scope, 25, 9);
  const set = (name: string, value: number) =>
    putChannel(state.surface, name, "ratio", new Float64Array(225).fill(value));
  set("elevation", 100);
  set("temperature", 18);
  set("moisture", 0.7);
  set("treeCover", trees);
  set("slope", 0);
  const random = randomStream("3", "society", "highways", "test", []);
  const context: MapProcessContext = {
    scope: state.domain.scope,
    invocation: [],
    parameters: {},
    epochs: [epoch("Kingdoms", 600, { mobility: 1, politicalCapacity: 1.2 })],
    epochIndices: [0],
    causes: [],
    recordCause() {},
    random: () => random.next(),
    cancelled: () => false,
    progress() {},
  };
  initializePopulation(state, context);
  refreshSocietySupport(state);
  const region = state.society!.region;
  for (const c of region.communities) {
    c.founded = "Founders";
    c.status = "inhabited";
    c.settlement = { population: 2000, peak: 2000, recoveryYears: 0 };
  }
  // One active, well-supported polity controls everything from its seat; its seat's busiest
  // way is worn far past the road class.
  const seat = region.communities[0];
  const polity = {
    id: "polity:1",
    seat: seat.id,
    support: 0.9,
    status: "active" as const,
    claims: [],
    causes: [],
  };
  region.politics = {
    polities: [polity],
    sovereignty: Object.fromEntries(region.communities.map((c) => [c.id, polity.id])),
    control: Object.fromEntries(region.communities.map((c) => [c.id, polity.id])),
    contested: {},
    history: [],
  };
  const busy = region.connections.find((l) => l.from === seat.id || l.to === seat.id)!;
  busy.wear = wayClasses().road * 2;
  return { state, context, region, busy, polity };
}

it("raises a straight highway from a strong polity's seat over open country", () => {
  const { state, context, region, busy, polity } = fixture(0);
  expect(raiseHighways(state, context)).toBe(1);
  expect(busy.highway?.polity).toBe(polity.id);
  expect(wayClass(busy)).toBe("highway");
  expect(busy.travelCost).toBeLessThan(busy.distance * 0.5);
  expect(region.connections.filter((l) => l.highway)).toHaveLength(1);
  // Raising it again does nothing: the way is already a highway.
  expect(raiseHighways(state, context)).toBe(0);
});

it("raises none through forest or for a polity without the means", () => {
  const forest = fixture(0.9);
  expect(raiseHighways(forest.state, forest.context)).toBe(0);
  const poor = fixture(0);
  poor.polity.support = 0.3;
  expect(raiseHighways(poor.state, poor.context)).toBe(0);
  const weak = fixture(0);
  weak.context.epochs = [epoch("Settlement", 300, { mobility: 1, politicalCapacity: 0.6 })];
  expect(raiseHighways(weak.state, weak.context)).toBe(0);
});
