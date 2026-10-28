import { expect, it } from "vitest";
import { putChannel, residentBand } from "@atlas/domain";
import { landscape, epoch } from "./mapFixtures";
import { initializePopulation } from "./societyPopulation";
import { refreshSocietyConnections } from "./societyGeography";
import { endRound } from "./societyRound";
import { publishRuinFields } from "./societyRuins";
import { resolveSocietyHazards, unitRadius } from "./societyHazards";
import { planSocietyWorks } from "./societyWorks";
import type { MapProcessContext } from "./process";

function fixture(profile: "world" | "local" = "world") {
  const state = landscape();
  state.domain.world.id = "bc07dcd0-7cba-46b1-8e56-5f7829dde8cb";
  state.domain.world.areas.area.profile = profile;
  const set = (name: string, value: number, unit = "ratio") =>
    putChannel(
      state.surface,
      name,
      unit,
      residentBand("float64", new Float64Array(10).fill(value))
    );
  set("elevation", 100, "metre");
  set("treeCover", 0.1);
  set("herbivores", 0.05);
  set("productivity", 0.2);
  const context: MapProcessContext = {
    scope: state.domain.scope,
    invocation: [],
    parameters: {},
    epochs: [epoch("Ice age", 100)],
    epochIndices: [0],
    causes: [],
    recordCause() {},
    random: () => 0,
    cancelled: () => false,
    progress() {},
  };
  initializePopulation(state, context);
  state.society!.region.communities = state.society!.region.communities.slice(0, 2);
  refreshSocietyConnections(state);
  for (const c of state.society!.region.communities) {
    c.groups[0].count = 200;
    c.status = "inhabited";
    c.founded = "Ice age";
  }
  return { state, context, set };
}
const ruins = (state: ReturnType<typeof fixture>["state"]) =>
  Object.values(state.domain.world.features).filter((f) => f.layerId === "ruins");

it("remembers every lasting camp but publishes only one that met the World's ruin rule", () => {
  const { state } = fixture();
  const [camp, town] = state.society!.region.communities;
  camp.settlement = { population: 30, peak: 40, recoveryYears: 0 };
  town.settlement = { population: 4000, peak: 6000, recoveryYears: 0 };
  const round = endRound(state, "Ice age", "Cold age");
  expect(round.ruins.map((r) => r.name).sort()).toEqual([camp.name, town.name].sort());
  expect(round.ruins.find((r) => r.name === camp.name)?.peak).toBe(40);
  expect(ruins(state).map((f) => f.name)).toEqual([town.name]);
  expect(camp.status).toBe("ruined");
});

it("realizes a camp as a ruin field only where a sealed vein marks its ground", () => {
  const { state } = fixture();
  const camp = state.society!.region.communities[0];
  camp.settlement = { population: 30, peak: 40, recoveryYears: 0 };
  state.rounds = [endRound(state, "Ice age", "Cold age")];
  state.domain.world.features = {};
  publishRuinFields(state);
  expect(ruins(state)).toEqual([]);
  const scar = new Float64Array(10);
  const cell = Array.from(state.society!.owner).findIndex((o) => o === 0);
  scar[cell] = 1;
  putChannel(state.surface, "magic:fire:feature:scar", "ratio", residentBand("float64", scar));
  publishRuinFields(state);
  const field = ruins(state).find((f) => f.attributes.ruinField === "a sealed vein");
  expect(field?.attributes).toMatchObject({ era: "Ice age", round: true, peakPopulation: 40 });
});

it("gives a World hazard the unit's footprint and a finer profile the point radius", () => {
  for (const profile of ["world", "local"] as const) {
    const { state, context, set } = fixture(profile);
    set("floodFrequency", 1);
    resolveSocietyHazards(state, context, 10);
    const flood = state.society!.region.events.find((e) => e.kind === "flood")!;
    const c = state.society!.region.communities.find((c) => flood.communities.includes(c.id))!;
    expect(flood.radius).toBeCloseTo(profile === "world" ? unitRadius(c) : 5000, 6);
  }
});

it("proposes cold-age tapping at World from the unit's own vein cells", () => {
  const { state } = fixture();
  state.society!.round = "Ice age";
  planSocietyWorks(state);
  expect(state.society!.region.works.some((w) => w.kind === "tapping")).toBe(false);
  const vein = new Float64Array(10);
  vein[Array.from(state.society!.owner).findIndex((o) => o === 0)] = 500;
  putChannel(state.surface, "magic:fire:intensity", "per-mille", residentBand("float64", vein));
  planSocietyWorks(state);
  const tapping = state.society!.region.works.find((w) => w.kind === "tapping");
  expect(tapping?.communityId).toBe(state.society!.region.communities[0].id);
  expect(tapping?.demand).toMatchObject({ unit: "fraction" });
});
