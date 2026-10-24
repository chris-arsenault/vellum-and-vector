import { expect, it } from "vitest";
import { gridPosition, putChannel } from "@atlas/domain";
import { landscape, epoch } from "./mapFixtures";
import { initializePopulation } from "./societyPopulation";
import { refreshSocietyConnections } from "./societyGeography";
import { applySocietyWorks, makeWork, workSamples } from "./societyWorks";
import { demandSamples, realizeDemands, workMedium } from "./societyDemand";
import type { MapProcessContext } from "./process";

function fixture(profile: "world" | "local") {
  const state = landscape();
  state.domain.world.id = "bc07dcd0-7cba-46b1-8e56-5f7829dde8cb";
  state.domain.world.areas.area.profile = profile;
  const set = (name: string, value: number, unit = "ratio") =>
    putChannel(state.surface, name, unit, new Float64Array(10).fill(value));
  set("elevation", 100, "metre");
  set("treeCover", 0.6);
  set("broadleafCover", 0.6);
  set("grassCover", 0.2);
  set("herbivores", 0.05);
  set("productivity", 0.2);
  const context: MapProcessContext = {
    scope: state.domain.scope,
    invocation: [],
    parameters: {},
    epochs: [epoch("Era", 100)],
    epochIndices: [0],
    causes: [],
    recordCause() {},
    random: () => 0.5,
    cancelled: () => false,
    progress() {},
  };
  initializePopulation(state, context);
  // One unit holds the whole country, so a demand has more than one cell to spread over.
  state.society!.region.communities = state.society!.region.communities.slice(0, 1);
  refreshSocietyConnections(state);
  for (const c of state.society!.region.communities) {
    c.groups[0].count = 1000;
    c.status = "inhabited";
  }
  return { state, context };
}
const unit = 0;

it("makes World works demands that act over the unit's whole country, conserving the total", () => {
  const { state, context } = fixture("world"),
    c = state.society!.region.communities[unit];
  const demand = makeWork(state, c, "clearance");
  expect(demand.demand).toBe(true);
  const located = makeWork(state, c, "clearance", c.position);
  expect(located.demand).toBeUndefined();
  const spread = demandSamples(state, demand),
    owned = Array.from(state.society!.owner).filter((o) => o === unit).length;
  expect(spread.length).toBe(owned);
  expect(spread.length).toBeGreaterThan(1);
  expect(workSamples(state, demand)).toEqual(spread);
  // The total the demand covers equals the located work's footprint, bounded by the country.
  const area = spread.reduce((sum, s) => sum + s.fraction * state.surface.measures[s.i], 0);
  expect(area).toBeCloseTo(
    Math.min(
      Math.PI * demand.radius ** 2,
      spread.reduce((sum, s) => sum + state.surface.measures[s.i], 0)
    ),
    3
  );
  state.society!.region.works = [{ ...demand, radius: 10000 }];
  applySocietyWorks(state, context, 100);
  const cleared = spread.filter((s) => state.surface.channels.treeCover[s.i] < 0.6);
  expect(cleared.length).toBe(spread.length);
});

it("filters a demand's cells by the kind's medium and realizes it at a finer profile", () => {
  const { state } = fixture("world"),
    c = state.society!.region.communities[unit];
  // A pass acts only on steep ground: give the unit one such cell away from its seat.
  const steep = 7;
  putChannel(state.surface, "slope", "gradient", new Float64Array(10).fill(0.01));
  state.surface.channels.slope[steep] = 0.2;
  const land = workMedium(state, "clearance"),
    pass = workMedium(state, "pass");
  expect(land(0)).toBe(true);
  expect(pass(0)).toBe(false);
  expect(pass(steep)).toBe(true);
  expect(demandSamples(state, makeWork(state, c, "pass")).map((s) => s.i)).toEqual([steep]);
  const demand = makeWork(state, c, "pass");
  state.society!.region.works = [demand];
  realizeDemands(state);
  expect(demand.demand).toBe(true); // World keeps its demands.
  state.domain.world.areas.area.profile = "local";
  realizeDemands(state);
  expect(demand.demand).toBeUndefined();
  expect(demand.causes.at(-1)).toContain("Realized at this profile");
  expect(demand.position).toEqual(gridPosition(state.surface, steep));
  // A demand with no medium in the refined area stays a demand.
  const weir = makeWork(state, c, "weir");
  weir.demand = true;
  state.society!.region.works = [weir];
  realizeDemands(state);
  expect(weir.demand).toBe(true);
});
