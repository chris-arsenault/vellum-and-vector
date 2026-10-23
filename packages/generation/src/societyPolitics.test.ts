import { expect, it } from "vitest";
import { putChannel, population } from "@atlas/domain";
import { landscape, epoch } from "./mapFixtures";
import { initializePolitics, evolvePolitics } from "./societyPolitics";
import type { MapProcessContext } from "./process";

function fixture() {
  const state = landscape();
  state.domain.world.id = "bc07dcd0-7cba-46b1-8e56-5f7829dde8cb";
  state.domain.world.areas.area.profile = "local";
  putChannel(state.surface, "elevation", "metre", new Float64Array(10).fill(100));
  const context: MapProcessContext = {
    scope: state.domain.scope,
    invocation: [],
    parameters: { polityCount: 1 },
    epochs: [epoch("Founding", 100, { politicalCapacity: 1 })],
    epochIndices: [0],
    causes: [],
    recordCause() {},
    random: () => 0.5,
    cancelled: () => false,
    progress() {},
  };
  initializePolitics(state, context);
  for (const c of state.society!.region.communities) {
    c.groups[0].count = 1000;
    c.support.capacity = 2000;
  }
  return { state, context };
}
it("keeps stable reach and preserves residents and claims through collapse and successor formation", () => {
  const { state, context } = fixture(),
    region = state.society!.region,
    politics = region.politics!;
  evolvePolitics(state, context, 100);
  expect(politics.polities[0].status).toBe("active");
  const groups = structuredClone(region.communities.map((c) => c.groups));
  const claims = [...politics.polities[0].claims];
  context.epochs = [epoch("Disruption", 200, { politicalCapacity: 0 })];
  evolvePolitics(state, context, 200);
  expect(politics.polities[0].status).toBe("collapsed");
  expect(politics.polities[0].claims).toEqual(claims);
  expect(region.communities.map((c) => c.groups)).toEqual(groups);
  expect(politics.polities.length).toBeGreaterThan(1);
  expect(politics.history.some((h) => h.status === "collapsed")).toBe(true);
  context.epochs = [epoch("Recovery", 200, { politicalCapacity: 1 })];
  evolvePolitics(state, context, 200);
  expect(Object.keys(politics.control).length).toBeGreaterThan(0);
  expect(region.communities.reduce((sum, c) => sum + population(c), 0)).toBeGreaterThan(0);
});
it("cannot project effective control through a disconnected graph", () => {
  const { state, context } = fixture(),
    region = state.society!.region;
  region.connections = [];
  evolvePolitics(state, context, 10);
  expect(Object.keys(region.politics!.control)).toHaveLength(1);
  expect(region.politics!.polities[0].claims.length).toBeGreaterThan(1);
});
