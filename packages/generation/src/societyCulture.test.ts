import { expect, it } from "vitest";
import { everySample, population, putChannel, residentBand } from "@atlas/domain";
import { landscape, epoch } from "./mapFixtures";
import { initializeCultures, diffuseCultures } from "./societyCulture";
import { publishCultures } from "./societyCulturePublication";
import type { MapProcessContext } from "./process";
import { initializePopulation } from "./societyPopulation";

function fixture() {
  const state = landscape();
  state.domain.world.id = "bc07dcd0-7cba-46b1-8e56-5f7829dde8cb";
  state.domain.world.areas.area.profile = "local";
  putChannel(
    state.surface,
    "elevation",
    "metre",
    residentBand("float64", new Float64Array(10).fill(100))
  );
  const context: MapProcessContext = {
    scope: state.domain.scope,
    invocation: [],
    parameters: { cultureCount: 2 },
    epochs: [epoch("Contact", 200)],
    epochIndices: [0],
    causes: [],
    recordCause() {},
    random: () => 0.5,
    cancelled: () => false,
    progress() {},
  };
  initializePopulation(state, context);
  for (const c of state.society!.region.communities) c.groups[0].count = 1000;
  initializeCultures(state, context);
  return { state, context };
}
it("diffuses language and faith without migration or demographic double counting", () => {
  const { state, context } = fixture(),
    [a, b] = state.society!.region.communities;
  a.groups = [{ ...a.groups[0], count: 100, languages: ["A"], religions: ["X"] }];
  b.groups = [{ ...b.groups[0], count: 100, languages: ["B"], religions: ["Y"] }];
  diffuseCultures(state, context, 200);
  expect(population(a)).toBeCloseTo(100, 10);
  expect(population(b)).toBeCloseTo(100, 10);
  expect(a.groups.some((g) => g.languages.includes("A") && g.languages.includes("B"))).toBe(true);
  expect(a.groups.some((g) => g.religions.includes("X") && g.religions.includes("Y"))).toBe(true);
});
it("retains ancestry when isolated communities diverge", () => {
  const { state, context } = fixture(),
    c = state.society!.region.communities[0];
  state.society!.region.connections = [];
  const parent = c.groups[0].culture,
    before = population(c);
  for (let cycle = 0; cycle < 50; cycle++) diffuseCultures(state, context, 10);
  expect(c.groups[0].culture).not.toBe(parent);
  expect(state.domain.world.entities[c.groups[0].culture!].relations).toContainEqual({
    targetId: parent,
    kind: "derivedFrom",
  });
  expect(population(c)).toBe(before);
  const id = c.groups[0].culture;
  diffuseCultures(state, context, 500);
  expect(c.groups[0].culture).toBe(id);
});
it("publishes cultural, language and religious prevalence independently", () => {
  const { state } = fixture();
  publishCultures(state);
  for (const kind of ["culture", "language", "religion"]) {
    const channels = Object.entries(state.surface.channels).filter(([key]) =>
      key.startsWith(`${kind}:`)
    );
    expect(channels.length).toBeGreaterThan(0);
    for (const [, values] of channels)
      expect(everySample(values, (v) => v >= 0 && v <= 1)).toBe(true);
  }
});
