import { expect, it } from "vitest";
import { createGrid, putChannel, rectangle, spatial } from "@atlas/domain";
import { landscape, epoch } from "./mapFixtures";
import type { MapProcessContext } from "./process";
import { initializePopulation, evolvePopulation, populationTotal } from "./societyPopulation";
import { retainSocietyFootprints } from "./societyInheritance";
import { publishSettlements } from "./societyPublication";
import { evolveSociety } from "./societyEvolution";
function societyFixture() {
  const state = landscape();
  state.domain.world.id = "bc07dcd0-7cba-46b1-8e56-5f7829dde8cb";
  const footprint = rectangle([0, 0, 300000, 100000]);
  state.domain.scope.footprint = footprint;
  state.domain.world.areas.area.footprint = footprint;
  state.surface = createGrid("society", state.domain.scope, 13, 5);
  putChannel(state.surface, "elevation", "metre", new Float64Array(65).fill(100));
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

it("refines rural catchments and located settlements without replaying eras", async () => {
  const { state, context } = societyFixture();
  initializePopulation(state, context);
  await evolveSociety(state, context, 200);
  retainSocietyFootprints(state);
  for (const c of state.society!.region.communities) {
    for (const group of c.groups) {
      group.languages = ["founding-language"];
      group.namingLanguage = "founding-language";
      delete group.languageShares;
    }
    if (c.founded) c.naming = { language: "founding-language", culture: "marches", era: c.founded };
  }
  // A major town has a global representation; smaller communities remain latent.
  const town = state.society!.region.communities.find((c) => c.founded && c.position.x < 150000)!;
  town.groups[0].count += 6000;
  town.settlement = { population: 6000, peak: 6000, recoveryYears: 0 };
  const original = structuredClone(state.domain.world.societies!.area);
  publishSettlements(state, context);
  const parentFeatures = Object.values(state.domain.world.features).filter(
    (f) => f.kind === "settlement"
  );
  const footprint = rectangle([0, 0, 150000, 100000]);
  const expected = original.communities.reduce((sum, c) => {
    const overlap = c.footprint && spatial.intersection(c.footprint, footprint);
    return (
      sum +
      (overlap
        ? ((c.groups.reduce((n, g) => n + g.count, 0) - (c.settlement?.population ?? 0)) *
            spatial.area(overlap)) /
            spatial.area(c.footprint!) +
          (spatial.pointCoverage(footprint)(c.position) ? (c.settlement?.population ?? 0) : 0)
        : 0)
    );
  }, 0);
  state.domain.world.areas.child = {
    ...state.domain.world.areas.area,
    id: "child",
    parentId: "area",
    footprint,
    profile: "region",
  };
  state.domain.scope = { ...state.domain.scope, areaId: "child", footprint };
  state.surface = createGrid("child", state.domain.scope, 17, 9);
  putChannel(state.surface, "elevation", "metre", new Float64Array(153).fill(100));
  initializePopulation(state, { ...context, scope: state.domain.scope });
  evolvePopulation(state, context, 1000);
  expect(populationTotal(state)).toBeCloseTo(expected, 5);
  expect(state.society!.region.history).toEqual(original.history);
  expect(state.domain.world.societies!.area).toEqual(original);
  expect(new Set(state.society!.region.communities.map((c) => c.id)).size).toBe(
    state.society!.region.communities.length
  );
  publishSettlements(state, { ...context, scope: state.domain.scope });
  const refined = parentFeatures.filter((f) => f.detail.child);
  expect(refined.length).toBeGreaterThan(0);
  for (const feature of refined) {
    expect(feature.detail.child.attributes?.namingLanguage).toBe("founding-language");
    const inherited = state.society!.region.communities.find(
      (c) => c.id === feature.attributes.communityId
    )!;
    expect(inherited.naming).toEqual(
      original.communities.find((c) => c.id === inherited.id)!.naming
    );
    expect(
      Object.values(state.domain.world.features).filter(
        (f) =>
          f.attributes.communityId === feature.attributes.communityId && f.kind === "settlement"
      )
    ).toHaveLength(1);
    feature.detail.child.state = "authored";
    feature.detail.child.attributes = { ...feature.detail.child.attributes, population: 123 };
  }
  publishSettlements(state, { ...context, scope: state.domain.scope });
  for (const feature of refined) expect(feature.detail.child.attributes?.population).toBe(123);
});
