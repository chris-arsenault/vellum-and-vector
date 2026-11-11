import { expect, it } from "vitest";
import {
  builtinLayers,
  createGrid,
  generateChannel,
  putChannel,
  rectangle,
  type SocietyCommunity,
  type SocietyRegion,
  fieldChannelName,
} from "@atlas/domain";
import { landscape } from "./mapFixtures";
import type { MapProcessContext } from "./process";
import { supplySociety } from "./societyTestFixture";
import { inheritSociety } from "./societyInheritance";
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
/** A same-area regeneration with a prior society: the inherited path the world engine keeps. */
function fixture() {
  const state = landscape(),
    world = state.domain.world,
    prior = parentSociety();
  world.id = "bc07dcd0-7cba-46b1-8e56-5f7829dde8cb";
  world.layers = Object.fromEntries(builtinLayers().map((layer) => [layer.id, layer]));
  world.societies = { area: prior };
  const footprint = rectangle([0, 0, 120000, 80000]);
  world.areas.area.footprint = footprint;
  state.domain.scope = { ...state.domain.scope, footprint, resolution: 10000 };
  state.surface = createGrid("area", state.domain.scope, 13, 9);
  for (const [key, value] of Object.entries({
    Elevation: 102400,
    Temperature: 480,
    Moisture: 1000,
    SoilDepth: 1,
    Productivity: 1,
    GrassCover: 0.5,
    RiverOrders: 2,
  }))
    putChannel(
      state.surface,
      fieldChannelName(key),
      key === "Elevation" ? "native-length" : "index",
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

it("keeps an inherited polity's world identity and character when publishing a partial territory", () => {
  const { state, prior } = fixture(),
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
  supplySociety(state);
  inheritSociety(state, prior);
  publishPolitics(state);
  expect(state.domain.world.entities[id]).toEqual(before);
  expect(state.society!.region.politics?.polities[0].id).toBe(id);
  expect(prior.politics.polities[0].claims).toEqual(["A", "B"]);
});
