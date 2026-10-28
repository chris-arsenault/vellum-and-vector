import { expect, it } from "vitest";
import { createGrid, population, putChannel, rectangle, residentBand } from "@atlas/domain";
import { landscape, epoch } from "./mapFixtures";
import { randomStream } from "./random";
import type { MapProcessContext } from "./process";
import { initializePopulation, populationTotal } from "./societyPopulation";
import { refreshSocietySupport } from "./societyGeography";
import { concentration, contactPopulation } from "./societySettlements";
import { drawToCentres, urbanTargets } from "./societyCentres";

function fixture() {
  const state = landscape();
  state.domain.world.id = "bc07dcd0-7cba-46b1-8e56-5f7829dde8cb";
  const footprint = rectangle([0, 0, 300000, 100000]);
  state.domain.scope.footprint = footprint;
  state.domain.world.areas.area.footprint = footprint;
  state.surface = createGrid("society", state.domain.scope, 25, 9);
  const set = (name: string, value: number) =>
    putChannel(
      state.surface,
      name,
      "ratio",
      residentBand("float64", new Float64Array(225).fill(value))
    );
  set("elevation", 100);
  set("temperature", 18);
  set("moisture", 0.7);
  set("treeCover", 0);
  const random = randomStream("11", "society", "centres", "test", []);
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
  refreshSocietySupport(state);
  const communities = state.society!.region.communities;
  // Every catchment settled and a third full; one of them already a town of eight thousand.
  for (const c of communities) {
    c.groups = [{ ...c.groups[0], count: c.support.capacity / 3 }];
    c.founded = "Founders";
    c.status = "inhabited";
    c.settlement = { population: 500, peak: 500, recoveryYears: 0 };
  }
  const city = communities.reduce((a, c) => (c.support.capacity > a.support.capacity ? c : a));
  city.settlement = { population: 8000, peak: 8000, recoveryYears: 0 };
  return { state, communities, city };
}

it("lets the largest town draw its hinterland's town-dwellers while small towns keep a local share", () => {
  const { state, communities, city } = fixture();
  expect(communities.length).toBeGreaterThan(3);
  const contact = contactPopulation(state);
  const demand = communities.map((c) => concentration(c, contact.get(c.id) ?? 0));
  const { targets, contributions } = urbanTargets(state);
  const i = communities.indexOf(city);
  expect(targets[i]).toBeGreaterThan(demand[i]);
  expect(contributions[i].length).toBeGreaterThan(1);
  for (const [j, c] of communities.entries()) {
    if (c === city) continue;
    expect(targets[j]).toBeLessThan(demand[j]);
    // The chief town keeps half of the local share; the rest lives in latent small towns.
    expect(targets[j]).toBeGreaterThanOrEqual(demand[j] * 0.15 - 1e-9);
  }
  // Allocation moves demand around; it never invents town-dwellers.
  const total = (xs: ArrayLike<number>) => Array.from(xs).reduce((s, x) => s + x, 0);
  expect(total(targets)).toBeLessThanOrEqual(total(demand) + 1e-6);
});

it("moves people toward the centre without creating or losing any", () => {
  const { state, communities, city } = fixture();
  const before = populationTotal(state),
    cityBefore = population(city);
  let moved = 0;
  for (let cycle = 0; cycle < 3; cycle++) {
    const allocation = urbanTargets(state);
    moved += drawToCentres(state, 20, allocation);
  }
  expect(moved).toBeGreaterThan(0);
  expect(population(city)).toBeGreaterThan(cityBefore);
  expect(populationTotal(state)).toBeCloseTo(before, 6);
  for (const c of communities) expect(population(c)).toBeGreaterThan(0);
});
