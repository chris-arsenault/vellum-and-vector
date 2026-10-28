import { expect, it } from "vitest";
import { createGrid, putChannel, rectangle, residentBand } from "@atlas/domain";
import { landscape, epoch } from "./mapFixtures";
import type { MapProcessContext } from "./process";
import { initializePopulation } from "./societyPopulation";

function fixture() {
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
    parameters: {},
    epochs: [epoch("Arrival", 200)],
    epochIndices: [0],
    causes: [],
    recordCause() {},
    random: () => 0.5,
    cancelled: () => false,
    progress() {},
  };
  return { state, context };
}
const west = (x: number) => x < 150000;

it("connects the two shores of a strait by sea while land connections stay on their side", () => {
  const { state, context } = fixture();
  const water = new Float64Array(65);
  for (let i = 0; i < 65; i++)
    if (i % 13 === 6) {
      state.surface.channels.elevation.set(i, -100);
      water[i] = 1;
    }
  putChannel(state.surface, "water", "category", residentBand("float64", water));
  initializePopulation(state, context);
  const region = state.society!.region,
    nodes = new Map(region.communities.map((c) => [c.id, c]));
  const crossings = region.connections.filter(
    (link) => west(nodes.get(link.from)!.position.x) !== west(nodes.get(link.to)!.position.x)
  );
  expect(crossings.length).toBeGreaterThan(0);
  expect(crossings.every((link) => link.kind === "sea")).toBe(true);
  expect(region.connections.some((link) => link.kind === "land")).toBe(true);
  for (const link of crossings) expect(link.travelCost).toBeGreaterThan(2 * 10000);
});

it("carries a connection along a river at half the cost of the land way", () => {
  const plain = fixture();
  initializePopulation(plain.state, plain.context);
  const { state, context } = fixture();
  const order = new Float64Array(65);
  for (let i = 0; i < 65; i++) if (Math.floor(i / 13) === 2) order[i] = 1;
  putChannel(state.surface, "riverOrder", "order", residentBand("float64", order));
  initializePopulation(state, context);
  const rivers = state.society!.region.connections.filter((link) => link.kind === "river");
  expect(rivers.length).toBeGreaterThan(0);
  const byPair = new Map(
    plain.state.society!.region.connections.map((link) => [`${link.from}:${link.to}`, link])
  );
  for (const link of rivers) {
    const overland = byPair.get(`${link.from}:${link.to}`);
    if (overland) expect(link.travelCost).toBeLessThan(overland.travelCost);
  }
});
