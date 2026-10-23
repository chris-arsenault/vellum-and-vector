import { expect, it } from "vitest";
import { canonryMagicPresets, population, putChannel, type SocietyEvent } from "@atlas/domain";
import { landscape, epoch } from "./mapFixtures";
import { initializePopulation, populationTotal } from "./societyPopulation";
import { applySocietyWorks, makeWork } from "./societyWorks";
import { useSocietyMagic } from "./societyMagic";
import { applySocietyEvent } from "./societyHazards";
import type { MapProcessContext } from "./process";
function fixture() {
  const state = landscape();
  state.domain.world.id = "bc07dcd0-7cba-46b1-8e56-5f7829dde8cb";
  state.domain.world.areas.area.profile = "local";
  const set = (name: string, value: number, unit = "ratio") =>
    putChannel(state.surface, name, unit, new Float64Array(10).fill(value));
  set("elevation", 100, "metre");
  set("treeCover", 0.6);
  set("broadleafCover", 0.6);
  set("grassCover", 0.2);
  set("herbivores", 0.05);
  set("productivity", 0.2);
  set("temperature", -10, "celsius");
  set("iceThickness", 100, "metre");
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
  for (const c of state.society!.region.communities) {
    c.groups[0].count = 1000;
    c.status = "inhabited";
  }
  return { state, context, set };
}
it("changes real vegetation and hunting quantities, while conservation restores supported fauna", () => {
  const { state, context } = fixture(),
    c = state.society!.region.communities[0];
  state.society!.region.works = ["clearance", "hunting"].map((kind) => ({
    ...makeWork(state, c, kind as "clearance" | "hunting"),
    radius: 10000,
  }));
  applySocietyWorks(state, context, 100);
  expect(state.surface.channels.treeCover[0]).toBeLessThan(0.6);
  expect(state.surface.channels.herbivores[0]).toBeLessThan(0.05);
  state.surface.channels.herbivores.fill(0.001);
  state.society!.region.works = [{ ...makeWork(state, c, "conservation"), radius: 10000 }];
  applySocietyWorks(state, context, 100);
  expect(state.surface.channels.herbivores[0]).toBeGreaterThan(0.001);
});
it("constructs a pass once and lets abandoned earthworks deteriorate", () => {
  const { state, context } = fixture(),
    c = state.society!.region.communities[0];
  const work = { ...makeWork(state, c, "pass"), radius: 10000 };
  c.groups[0].count = 1000;
  state.society!.region.works = [work];
  applySocietyWorks(state, context, 10);
  const height = state.surface.channels.elevation[0];
  applySocietyWorks(state, context, 10);
  expect(state.surface.channels.elevation[0]).toBeCloseTo(height, 8);
  work.maintained = false;
  applySocietyWorks(state, context, 100);
  expect(state.surface.channels.elevation[0]).toBeGreaterThan(height);
});
it("consumes finite core deposits and removes supplied heat when fuel is exhausted", () => {
  const { state, context, set } = fixture();
  state.domain.world.magicSystems = canonryMagicPresets().map((s) => ({
    ...s,
    enabled: s.id === "fire",
  }));
  set("magic:fire:intensity", 800, "relative-intensity");
  useSocietyMagic(state, context, 100);
  const p = state.society!.region.magic[0];
  const accounted = () =>
    state.society!.region.magic.reduce(
      (sum, practice) => sum + practice.coreDeposit + practice.coreSupply + practice.coreUsed,
      0
    );
  const total = accounted();
  expect(p.coreUsed).toBeGreaterThan(0);
  useSocietyMagic(state, context, 100);
  expect(accounted()).toBeCloseTo(total, 7);
  const warm = state.surface.channels.temperature[0];
  for (const practice of state.society!.region.magic) {
    practice.coreDeposit = 0;
    practice.coreSupply = 0;
  }
  useSocietyMagic(state, context, 100);
  expect(state.surface.channels.temperature[0]).toBeLessThan(warm);
  expect(state.surface.channels["magic:fire:intensity"][0]).toBe(800);
});
it("requires reachable ocean depth for Pressure and cold crystals for Aurora knowledge", () => {
  const { state, context, set } = fixture();
  state.domain.world.magicSystems = canonryMagicPresets().map((s) => ({
    ...s,
    enabled: s.id !== "fire",
  }));
  set("magic:aurora:intensity", 800);
  set("magic:pressure:intensity", 800);
  set("water", 1, "category");
  set("waterDepth", 500, "metre");
  useSocietyMagic(state, context, 100);
  expect(state.society!.region.magic[0].memoryAccess).toBeGreaterThan(0);
  expect(state.society!.region.magic[0].divers).toBe(0);
  state.surface.channels.waterDepth.fill(100);
  useSocietyMagic(state, context, 100);
  expect(state.society!.region.magic[0].divers).toBeGreaterThan(0);
});
it("applies a disturbance once and conserves surviving displaced people", () => {
  const { state } = fixture(),
    c = state.society!.region.communities[0],
    before = populationTotal(state);
  const event: SocietyEvent = {
    id: "event",
    era: "Era",
    kind: "flood",
    position: c.position,
    radius: 1000,
    magnitude: 1,
    casualties: 0,
    displaced: 0,
    communities: [],
    causes: ["Flood"],
  };
  applySocietyEvent(state, event);
  expect(populationTotal(state) + event.casualties).toBeCloseTo(before, 8);
  expect(event.displaced).toBeGreaterThan(0);
  const after = population(c);
  applySocietyEvent(state, event);
  expect(population(c)).toBe(after);
  expect(c.status).toBe("ruined");
});
