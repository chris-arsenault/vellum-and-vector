import { expect, it } from "vitest";
import {
  builtinLayers,
  editSocietyFeature,
  establishBoundary,
  projectChanges,
  refinedDrainageFeatures,
  rectangle,
  validateCrossings,
  type ChangeSet,
} from "@atlas/domain";
import { landscape, epoch } from "./mapFixtures";
import { initializePopulation, evolvePopulation } from "./societyPopulation";
import { publishSettlements } from "./societyPublication";
import type { MapProcessContext } from "./process";

function fixture() {
  const state = landscape();
  state.domain.world.areas.area.profile = "region";
  state.domain.world.id = "bc07dcd0-7cba-46b1-8e56-5f7829dde8cb";
  state.domain.world.layers = Object.fromEntries(builtinLayers().map((l) => [l.id, l]));
  const context: MapProcessContext = {
    scope: state.domain.scope,
    invocation: [],
    parameters: {},
    epochs: [epoch("Settlement", 100)],
    epochIndices: [0],
    causes: [],
    recordCause() {},
    random: () => 0.5,
    cancelled: () => false,
    progress() {},
  };
  initializePopulation(state, context);
  evolvePopulation(state, context, 100);
  const c = state.society!.region.communities[0];
  c.groups[0].count = 10000;
  c.founded = "Authored fixture";
  c.status = "inhabited";
  c.settlement = { population: 1000, peak: 1000, recoveryYears: 0 };
  publishSettlements(state, context);
  return { state, context };
}
it("edits present residents and protection while retaining completed history", () => {
  const { state } = fixture(),
    snapshot = state.domain;
  const feature = structuredClone(
    Object.values(snapshot.world.features).find((f) => f.kind === "settlement")!
  );
  const history = structuredClone(state.society!.region.history);
  const rural = Number(feature.attributes.ruralPopulation);
  feature.attributes.population = 1234;
  feature.protected = true;
  const changes: ChangeSet = {
    operationId: "edit",
    actor: "creator",
    worldId: snapshot.world.id,
    expectedVersion: 1,
    readSet: [],
    writes: [],
    removes: [],
    invalidations: [],
    highImpact: false,
  };
  editSocietyFeature(snapshot, changes, feature);
  changes.writes.push({ kind: "feature", value: feature });
  const result = projectChanges(snapshot, changes).world.societies!.area;
  const c = result.communities.find((c) => c.id === feature.attributes.communityId)!;
  expect(c.settlement!.population).toBe(1234);
  expect(c.groups.reduce((sum, g) => sum + g.count, 0)).toBeCloseTo(1234 + rural, 8);
  expect(c.protected).toBe(true);
  expect(result.history).toEqual(history);
  feature.attributes.groups = [
    { people: "Residents", culture: null, languages: [], religions: [], practices: [], count: -1 },
  ];
  expect(() => editSocietyFeature(snapshot, changes, feature)).toThrow();
});
it("materializes an unmapped retained river before committing refinement crossings", () => {
  const { state } = fixture(),
    snapshot = state.domain,
    world = snapshot.world;
  world.drainage = {
    area: {
      areaId: "area",
      spaceId: "surface",
      reaches: [
        {
          downstream: null,
          waterBody: 1,
          order: 1,
          basin: 1,
          coordinates: [
            [0, 500],
            [1000, 500],
            [2000, 500],
            [4000, 500],
          ],
          discharges: [2, 3, 4, 5],
          catchmentAreas: [10, 20, 30, 40],
          featureIds: [],
        },
      ],
    },
  };
  const area = {
    ...world.areas.area,
    id: "child",
    parentId: "area",
    profile: "region" as const,
    footprint: rectangle([500, 100, 2500, 900]),
  };
  const features = refinedDrainageFeatures(snapshot, area);
  expect(features).toHaveLength(1);
  world.areas.child = area;
  for (const feature of features) world.features[feature.id] = feature;
  area.boundary = establishBoundary(snapshot, area);
  expect(area.boundary.crossings).toHaveLength(2);
  expect(() =>
    validateCrossings(snapshot, area, features[0], features[0].geometry, features[0].attributes)
  ).not.toThrow();
});

it("edits a child settlement population without replacing the parent population or history", () => {
  const { state } = fixture(),
    snapshot = state.domain;
  const feature = structuredClone(
    Object.values(snapshot.world.features).find((f) => f.kind === "settlement")!
  );
  const parent = structuredClone(snapshot.world.societies!.area);
  const child = structuredClone(parent);
  child.areaId = "child";
  snapshot.world.societies!.child = child;
  const c = child.communities.find((c) => c.id === feature.attributes.communityId)!;
  c.groups = c.groups.map((g) => ({ ...g, count: g.count / 2 }));
  c.settlement!.population /= 2;
  const rural = c.groups.reduce((sum, g) => sum + g.count, 0) - c.settlement!.population;
  snapshot.world.features[feature.id].detail.child = {
    id: "detail",
    geometry: feature.geometry,
    attributes: { ...feature.attributes, groups: structuredClone(c.groups) },
    state: "generated",
    protected: false,
    actor: "generator",
    generationId: null,
    needsReconciliation: false,
  };
  feature.attributes = {
    ...feature.attributes,
    groups: structuredClone(c.groups),
    population: 432,
  };
  const changes: ChangeSet = {
    operationId: "edit",
    actor: "creator",
    worldId: snapshot.world.id,
    expectedVersion: 1,
    readSet: [],
    writes: [],
    removes: [],
    invalidations: [],
    highImpact: false,
  };
  editSocietyFeature(snapshot, changes, feature, "child");
  const result = projectChanges(snapshot, changes).world;
  expect(
    result
      .societies!.child.communities.find((c) => c.id === feature.attributes.communityId)!
      .groups.reduce((sum, g) => sum + g.count, 0)
  ).toBeCloseTo(432 + rural, 8);
  expect(
    result.societies!.child.communities.find((c) => c.id === feature.attributes.communityId)!
      .settlement!.population
  ).toBe(432);
  expect(result.societies!.area).toEqual(parent);
  expect(result.societies!.child.history).toEqual(parent.history);
});

it("rejects invalid work geometry parameters before storing an authored work", () => {
  const { state } = fixture(),
    snapshot = state.domain;
  const feature = structuredClone(
    Object.values(snapshot.world.features).find((f) => f.kind === "settlement")!
  );
  feature.kind = "societyWork";
  feature.attributes = { workKind: "dam", radius: -1, magnitude: 1 };
  const changes: ChangeSet = {
    operationId: "edit",
    actor: "creator",
    worldId: snapshot.world.id,
    expectedVersion: 1,
    readSet: [],
    writes: [],
    removes: [],
    invalidations: [],
    highImpact: false,
  };
  expect(() => editSocietyFeature(snapshot, changes, feature)).toThrow();
  expect(changes.worldMetadata).toBeUndefined();
});
