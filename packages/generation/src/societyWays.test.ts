import { expect, it } from "vitest";
import { createGrid, putChannel, rectangle, residentBand } from "@atlas/domain";
import { landscape, epoch } from "./mapFixtures";
import { randomStream } from "./random";
import type { MapProcessContext } from "./process";
import { initializePopulation } from "./societyPopulation";
import { refreshSocietySupport } from "./societyGeography";
import { drawToCentres, urbanTargets } from "./societyCentres";
import { wayClass, wayClasses, wearWays, wornCost } from "./societyWays";
import { compactGroups } from "./societyGroups";

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
  const random = randomStream("5", "society", "ways", "test", []);
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
  const region = state.society!.region;
  for (const c of region.communities) {
    c.groups = [{ ...c.groups[0], count: c.support.capacity / 2 }];
    c.founded = "Founders";
    c.status = "inhabited";
    c.settlement = { population: 300, peak: 300, recoveryYears: 0 };
  }
  const city = region.communities.reduce((a, c) =>
    c.support.capacity > a.support.capacity ? c : a
  );
  city.settlement = { population: 20000, peak: 20000, recoveryYears: 0 };
  return { state, region, city };
}

it("wears the ways to the city more than the ways beside them, and forgets them when traffic stops", () => {
  const { state, region, city } = fixture();
  for (let cycle = 0; cycle < 4; cycle++) {
    drawToCentres(state, 20, urbanTargets(state));
    wearWays(state, 20);
  }
  const atCity = region.connections.filter((l) => l.from === city.id || l.to === city.id),
    elsewhere = region.connections.filter((l) => l.from !== city.id && l.to !== city.id);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
  expect(mean(atCity.map((l) => l.wear ?? 0))).toBeGreaterThan(
    mean(elsewhere.map((l) => l.wear ?? 0))
  );
  for (const l of region.connections) {
    expect(l.travelCost).toBeLessThanOrEqual(l.distance + 1e-9);
    expect(l.travelCost).toBeGreaterThanOrEqual(wornCost({ ...l, wear: Infinity }) - 1e-9);
  }
  const worn = region.connections.reduce((a, l) => ((l.wear ?? 0) > (a.wear ?? 0) ? l : a));
  const before = worn.wear!;
  for (const c of region.communities) c.settlement!.population = 0;
  state.society!.traffic = undefined;
  wearWays(state, 300);
  expect(worn.wear!).toBeLessThan(before * 0.2);
});

it("classes a way by its yearly travellers", () => {
  expect(wayClass({ wear: 0 })).toBeNull();
  expect(wayClass({ wear: wayClasses().track })).toBe("track");
  expect(wayClass({ wear: wayClasses().road })).toBe("road");
  expect(wornCost({ distance: 1000, wear: 0, kind: "land" })).toBe(1000);
  expect(wornCost({ distance: 1000, wear: wayClasses().road * 3, kind: "land" })).toBeCloseTo(600);
  expect(wornCost({ distance: 1000, wear: wayClasses().road * 3, kind: "sea" })).toBe(1000);
});

it("folds slivers into the largest group of the same people without changing the count", () => {
  const groups = compactGroups([
    { people: "p", culture: "a", languages: [], religions: [], practices: [], count: 100 },
    { people: "p", culture: "b", languages: [], religions: [], practices: [], count: 0.4 },
    { people: "p", culture: "c", languages: [], religions: [], practices: [], count: 2 },
  ]);
  expect(groups).toHaveLength(2);
  expect(groups.reduce((s, g) => s + g.count, 0)).toBeCloseTo(102.4, 9);
  expect(groups.find((g) => g.culture === "a")!.count).toBeCloseTo(100.4, 9);
});
