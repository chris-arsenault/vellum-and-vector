import { expect, it } from "vitest";
import { createGrid, population, putChannel, rectangle } from "@atlas/domain";
import { landscape, epoch } from "./mapFixtures";
import { randomStream } from "./random";
import type { MapProcessContext } from "./process";
import { initializePopulation, populationTotal } from "./societyPopulation";
import { refreshSocietySupport } from "./societyGeography";
import { evolveSociety } from "./societyEvolution";
import { makeWork } from "./societyWorks";
import { useSocietyMagic } from "./societyMagic";
import { publishSettlements } from "./societyPublication";
import { evolveSettlements } from "./societySettlements";
import { applySocietyEvent } from "./societyHazards";

function fixture(seed = "42") {
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
  set("treeCover", 0);
  const random = randomStream(seed, "society", "evolve", "test", []);
  const context: MapProcessContext = {
    scope: state.domain.scope,
    invocation: [],
    parameters: {},
    epochs: [epoch("Settlement", 200, { mobility: 1 })],
    epochIndices: [0],
    causes: [],
    recordCause() {},
    random: () => random.next(),
    cancelled: () => false,
    progress() {},
  };
  initializePopulation(state, context);
  return { state, context, set };
}

it("feeds finite Fire heating back into growth and decline within one era", async () => {
  const { state, context, set } = fixture();
  const work = state.society!,
    c = work.region.communities[0];
  work.region.communities = [c];
  work.region.connections = [];
  work.owner.fill(0);
  set("temperature", -8);
  refreshSocietySupport(state);
  c.groups[0].count = c.support.capacity * 1.4;
  c.founded = "Founders";
  c.status = "inhabited";
  useSocietyMagic(state, context, 0);
  const practice = work.region.magic[0];
  const fuel = population(c) * 0.0005 * 30;
  practice.coreDeposit = fuel;
  work.region.works = [{ ...makeWork(state, c, "fire-forge"), radius: 1000000 }];
  await evolveSociety(state, context, 200);
  const history = c.history!;
  expect(history.some((h, i) => i > 0 && h.population > history[i - 1].population)).toBe(true);
  expect(history.some((h, i) => i > 0 && h.population < history[i - 1].population)).toBe(true);
  expect(Math.max(...history.map((h) => h.capacity))).toBeGreaterThan(history.at(-1)!.capacity);
  expect(practice.coreUsed).toBeCloseTo(fuel, 5);
  expect(practice.heatApplied).toBe(0);
  const record = work.region.history[0];
  expect(work.region.history).toHaveLength(1);
  // Cycles follow the pace of change: more than one, never more than the settled decade gives.
  expect(record.cycles).toBeGreaterThan(1);
  expect(record.cycles).toBeLessThanOrEqual(20);
  expect(record.years).toBeCloseTo(200, 6);
  expect(record.before + record.births - record.deaths).toBeCloseTo(record.after, 5);
});

it("colonizes reachable country over cycles while a disconnected valley stays empty", async () => {
  const { state, context } = fixture();
  const region = state.society!.region;
  for (const c of region.communities) c.groups[0].count = 0;
  const [source, destination, isolated] = region.communities;
  source.groups[0].count = 50000;
  region.connections = [
    { from: source.id, to: destination.id, distance: 10000, travelCost: 10000, kind: "land" },
  ];
  await evolveSociety(state, context, 200);
  expect(population(destination)).toBeGreaterThan(100);
  expect(destination.founded).toContain("Settlement");
  expect(destination.history![0].population).toBeLessThan(destination.history!.at(-1)!.population);
  expect(population(isolated)).toBe(0);
  state.domain.world.areas.area.profile = "region";
  publishSettlements(state, context);
  const published = Object.values(state.domain.world.features).filter(
    (f) => f.kind === "settlement"
  );
  expect(published.some((f) => f.attributes.communityId === destination.id)).toBe(true);
  expect(published.some((f) => f.attributes.communityId === isolated.id)).toBe(false);
});

it("abandons unsupported settlements and recovers the same identity when conditions return", async () => {
  const { state, context, set } = fixture();
  const region = state.society!.region,
    c = region.communities[0];
  region.connections = [];
  c.groups[0].count = 10000;
  evolveSettlements(state, context, 100);
  expect(c.status).toBe("inhabited");
  const id = c.id,
    founded = c.founded;
  set("ice", 1);
  await evolveSociety(state, context, 300);
  expect(c.status).toBe("abandoned");
  expect(c.settlement!.population).toBeLessThan(20);
  set("ice", 0);
  await evolveSociety(state, context, 1000);
  expect(c.status).toBe("inhabited");
  expect(c.id).toBe(id);
  expect(c.founded).toBe(founded);
  expect(c.causes.some((s) => s.includes("inhabited → abandoned"))).toBe(true);
  expect(c.causes.some((s) => s.includes("abandoned → inhabited"))).toBe(true);
});

it("retains ruins and conserves survivors while recovery proceeds without politics", async () => {
  const { state, context } = fixture();
  const c = state.society!.region.communities[0];
  c.groups[0].count = 10000;
  evolveSettlements(state, context, 100);
  const before = populationTotal(state);
  const event = {
    id: "destruction",
    era: "Settlement",
    kind: "thermal-fracture",
    position: c.position,
    radius: 1,
    magnitude: 1,
    casualties: 0,
    displaced: 0,
    communities: [],
    causes: ["Located fracture"],
  };
  applySocietyEvent(state, event);
  expect(c.status).toBe("ruined");
  expect(populationTotal(state) + event.casualties).toBeCloseTo(before, 6);
  await evolveSociety(state, context, 100);
  expect(c.status).toBe("inhabited");
  expect(state.society!.region.events).toHaveLength(1);
  expect(c.causes.some((s) => s.includes("ruined → inhabited"))).toBe(true);
});

it("disperses a flooded settlement into its catchment without inventing deaths", () => {
  const { state, context, set } = fixture();
  const c = state.society!.region.communities[0];
  c.groups[0].count = 10000;
  evolveSettlements(state, context, 100);
  expect(c.settlement!.population).toBeGreaterThan(80);
  const before = populationTotal(state);
  set("water", 1);
  evolveSettlements(state, context, 10);
  expect(c.settlement!.population).toBe(0);
  expect(c.status).toBe("abandoned");
  expect(populationTotal(state)).toBe(before);
  expect(c.causes.some((cause) => cause.includes("site became water"))).toBe(true);
});

it.each(["42", "valleys", "coast"])(
  "develops reproducible uneven occupation from defaults for %s",
  async (seed) => {
    const a = fixture(seed),
      b = fixture(seed);
    const before = a.state.society!.region.communities.map(population);
    expect(before.some((n) => n === 0)).toBe(true);
    await evolveSociety(a.state, a.context, 200);
    await evolveSociety(b.state, b.context, 200);
    const communities = a.state.society!.region.communities;
    expect(communities).toEqual(b.state.society!.region.communities);
    expect(communities.some((c, i) => before[i] === 0 && population(c) > 0)).toBe(true);
    const sizes = communities.map((c) => c.settlement!.population).filter((n) => n >= 80);
    expect(sizes.length).toBeGreaterThan(1);
    expect(Math.max(...sizes) / Math.min(...sizes)).toBeGreaterThan(2);
  }
);
