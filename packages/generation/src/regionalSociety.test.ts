import { expect, it, vi } from "vitest";
import {
  builtinLayers,
  createGrid,
  generateChannel,
  population,
  putChannel,
  rectangle,
  spatial,
  type SocietyCommunity,
  type SocietyRegion,
} from "@atlas/domain";
import { landscape } from "./mapFixtures";
import type { MapProcessContext } from "./process";
import { initializePopulation, populationTotal } from "./societyPopulation";
import { realizeRegionalPlaces } from "./regionalSociety";
import { publishSettlements } from "./societyPublication";
import { emptySupport } from "./societySupport";
import { publishPolitics } from "./societyPoliticalPublication";

function community(
  id: string,
  x: number,
  bounds: [number, number, number, number]
): SocietyCommunity {
  return {
    id,
    name: id,
    position: { x, y: 40000, z: 0 },
    footprint: rectangle(bounds),
    areaKm2: 4800,
    groups: [
      {
        people: "residents",
        culture: "culture",
        languages: ["language"],
        religions: ["faith"],
        practices: ["farming"],
        count: 200000,
      },
    ],
    support: { ...emptySupport(), farming: 200000, capacity: 200000, water: 1 },
    founded: "Old era",
    status: "inhabited",
    protected: false,
    causes: [],
    settlement: { population: 10000, peak: 12000, recoveryYears: 0 },
    latentSettlementPopulation: 25000,
    site: { kind: "river-node", reason: "Established river crossing", fortress: false },
    naming: { language: "language", culture: "culture", era: "Old era" },
  };
}
function parentSociety(): SocietyRegion {
  return {
    areaId: "area",
    spaceId: "surface",
    communities: [
      community("A", 30000, [0, 0, 60000, 80000]),
      community("B", 90000, [60000, 0, 240000, 80000]),
    ],
    connections: [
      {
        from: "A",
        to: "B",
        kind: "land",
        distance: 60000,
        travelCost: 27000,
        wear: 1600,
        highway: { polity: "old-polity", built: "Old era", name: "The inherited highway" },
      },
      { from: "A", to: "B", kind: "door", distance: 20, travelCost: 20 },
    ],
    history: [
      {
        id: "Old era",
        years: 500,
        before: 100000,
        births: 300000,
        deaths: 0,
        migrated: 0,
        after: 400000,
        causes: [],
      },
    ],
    works: [],
    magic: [],
    events: [],
  };
}
function fixture() {
  const state = landscape(),
    world = state.domain.world,
    prior = parentSociety();
  world.id = "bc07dcd0-7cba-46b1-8e56-5f7829dde8cb";
  world.layers = Object.fromEntries(builtinLayers().map((layer) => [layer.id, layer]));
  world.societies = { area: prior };
  world.areas.area.footprint = rectangle([0, 0, 240000, 80000]);
  const footprint = rectangle([0, 0, 120000, 80000]);
  world.areas.child = {
    ...world.areas.area,
    id: "child",
    profile: "region",
    parentId: "area",
    footprint,
  };
  state.domain.scope = { ...state.domain.scope, areaId: "child", footprint, resolution: 10000 };
  state.surface = createGrid("child", state.domain.scope, 13, 9);
  for (const [key, value] of Object.entries({
    elevation: 100,
    temperature: 18,
    moisture: 1,
    soilDepth: 1,
    productivity: 1,
    grassCover: 0.5,
    riverOrder: 2,
  }))
    putChannel(
      state.surface,
      key,
      key === "elevation" ? "metre" : "index",
      generateChannel(state.surface, key, () => value)
    );
  const context: MapProcessContext = {
    scope: state.domain.scope,
    invocation: [],
    parameters: {},
    epochs: [],
    epochIndices: [],
    causes: [],
    recordCause() {},
    random: () => 0.5,
    cancelled: () => false,
    progress() {},
  };
  return { state, context, prior };
}

it("reveals inherited town residents at viable sites, retaining seats and transport history without adding people or years", () => {
  const { state, context, prior } = fixture(),
    original = structuredClone(prior);
  initializePopulation(state, context);
  const before = populationTotal(state);
  expect(before).toBeCloseTo(200000 + 190000 / 3 + 10000, 5);
  const latent = state.society!.region.communities.reduce(
    (n, c) => n + (c.latentSettlementPopulation ?? 0),
    0
  );
  realizeRegionalPlaces(state);
  const region = state.society!.region,
    fresh = region.communities.filter((c) => c.founded && !["A", "B"].includes(c.id));
  expect(fresh.length).toBeGreaterThan(0);
  expect(fresh.every((c) => c.site && /river junction|river crossing/.test(c.site.reason))).toBe(
    true
  );
  expect(populationTotal(state)).toBeCloseTo(before, 8);
  expect(
    region.communities.reduce(
      (n, c) =>
        n +
        (c.latentSettlementPopulation ?? 0) +
        (fresh.includes(c) ? c.settlement!.population : 0),
      0
    )
  ).toBeCloseTo(latent, 8);
  for (const origin of prior.communities) {
    const retained = region.communities.find((c) => c.id === origin.id)!;
    expect(retained.position).toEqual(origin.position);
    expect(retained.settlement).toEqual(origin.settlement);
    expect(retained.naming).toEqual(origin.naming);
  }
  expect(region.connections.find((link) => link.highway)?.highway).toEqual(
    prior.connections[0].highway
  );
  expect(region.connections.some((link) => link.kind === "door" && link.travelCost === 20)).toBe(
    true
  );
  expect(region.history).toEqual(original.history);
  expect(prior).toEqual(original);
  expect(
    region.communities.every((c) =>
      c.groups.every(
        (g) =>
          g.culture === "culture" &&
          g.languages.includes("language") &&
          g.religions.includes("faith")
      )
    )
  ).toBe(true);
  publishSettlements(state, context);
  expect(
    Object.values(state.domain.world.features).some((f) => f.name === "The inherited highway")
  ).toBe(true);
  expect(fresh.every((c) => (c.settlement?.population ?? 0) <= population(c))).toBe(true);
});

it("does not invent settlers when the parent has no society", () => {
  const { state, context } = fixture();
  state.domain.world.societies = {};
  initializePopulation(state, context);
  realizeRegionalPlaces(state);
  expect(populationTotal(state)).toBe(0);
  expect(state.society!.region.history).toEqual([]);
});
it("reveals a smaller inherited settlement on habitable plains", () => {
  const { state, context, prior } = fixture(),
    original = structuredClone(prior);
  state.surface.channels.riverOrder.fill(0);
  initializePopulation(state, context);
  const heir = state.society!.region.communities.find((c) => !c.founded)!;
  expect(heir).toBeDefined();
  heir.groups[0].count = 1000;
  heir.latentSettlementPopulation = 400;
  heir.site = { kind: "plain", reason: "Inhabited agricultural plain", fortress: false };
  heir.support.capacity = 2000;
  const before = populationTotal(state);
  realizeRegionalPlaces(state);
  expect(heir.settlement?.population).toBe(400);
  expect(heir.founded).not.toBe("");
  expect(populationTotal(state)).toBe(before);
  expect(state.society!.region.history).toEqual(original.history);
  expect(prior).toEqual(original);
});
it("keeps local population and completed history unchanged by distant parent countries", () => {
  const local = fixture(),
    extended = fixture();
  for (let i = 0; i < 128; i++) {
    const x = 1_000_000 + i * 100_000;
    extended.prior.communities.push(
      community(`Distant ${i}`, x + 30_000, [x, 0, x + 60_000, 80_000])
    );
  }
  initializePopulation(local.state, local.context);
  const source = structuredClone(extended.prior),
    intersections = vi.spyOn(spatial, "intersects"),
    started = performance.now();
  try {
    initializePopulation(extended.state, extended.context);
    console.info("regional inheritance", {
      parentCountries: source.communities.length,
      childCountries: extended.state.society!.region.communities.length,
      intersects: intersections.mock.calls.length,
      milliseconds: performance.now() - started,
    });
    expect(extended.state.society!.region).toEqual(local.state.society!.region);
    expect(extended.prior).toEqual(source);
  } finally {
    intersections.mockRestore();
  }
});

it("leaves unresolved local occupation latent when refined ground offers no site", () => {
  const { state, context } = fixture();
  state.surface.channels.riverOrder.fill(0);
  initializePopulation(state, context);
  for (const c of state.society!.region.communities) if (!c.founded) delete c.site;
  const before = state.society!.region.communities.map((c) => c.latentSettlementPopulation);
  realizeRegionalPlaces(state);
  expect(state.society!.region.communities.map((c) => c.latentSettlementPopulation)).toEqual(
    before
  );
  expect(
    state
      .society!.region.communities.filter((c) => c.founded)
      .map((c) => c.id)
      .sort()
  ).toEqual(["A", "B"]);
});

it("keeps an inherited polity's world identity and character when publishing a partial regional territory", () => {
  const { state, context, prior } = fixture(),
    id = "old-polity";
  prior.politics = {
    polities: [{ id, seat: "A", support: 1, status: "active", claims: ["A", "B"], causes: [] }],
    sovereignty: { A: id, B: id },
    control: { A: id, B: id },
    contested: {},
    history: [],
  };
  const entity = {
    id,
    kind: "polity",
    name: "Inherited polity",
    state: "generated" as const,
    attributes: {
      character: { communities: 2, people: 400000, languages: 1, practices: { farming: 1 } },
      namedInEra: "Old era",
    },
  };
  state.domain.world.entities[id] = entity;
  const before = structuredClone(entity);
  initializePopulation(state, context);
  publishPolitics(state);
  expect(state.domain.world.entities[id]).toEqual(before);
  expect(state.society!.region.politics?.polities[0].id).toBe(id);
  expect(prior.politics.polities[0].claims).toEqual(["A", "B"]);
});
