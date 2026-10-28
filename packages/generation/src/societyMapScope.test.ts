import { expect, it } from "vitest";
import {
  builtinLayers,
  residentBand,
  type SocietyCommunity,
  type SocietyRegion,
} from "@atlas/domain";
import { landscape } from "./mapFixtures";
import { emptySupport } from "./societySupport";
import { relocatePolitySeats, settlementHierarchy } from "./societyHierarchy";
import { publishSettlements } from "./societyPublication";
import { publishCultures } from "./societyCulturePublication";
import { makeWork } from "./societyWorks";
import { realizeDemands } from "./societyDemand";
import type { MapProcessContext } from "./process";

// Connected hinterlands, an isolated town and a sovereign seat share one publication fixture.
// eslint-disable-next-line max-lines-per-function
function fixture() {
  const state = landscape(),
    world = state.domain.world;
  world.id = "bc07dcd0-7cba-46b1-8e56-5f7829dde8cb";
  world.layers = Object.fromEntries(builtinLayers().map((l) => [l.id, l]));
  const communities: SocietyCommunity[] = [2000, 100, 100, 3000, 200, 100, 6000].map((n, i) => ({
    id: `c${i}`,
    name: `Place ${i}`,
    position: { x: i * 500, y: 500, z: 0 },
    areaKm2: 100,
    groups: [
      {
        people: "p",
        culture: "culture",
        languages: ["language"],
        religions: [],
        practices: [],
        count: n * 2,
      },
    ],
    support: emptySupport(),
    founded: "Arrival",
    status: "inhabited",
    protected: false,
    causes: [],
    settlement: { population: n, peak: n, recoveryYears: 0 },
  }));
  const region: SocietyRegion = {
    areaId: "area",
    spaceId: "surface",
    communities,
    works: [],
    events: [],
    magic: [],
    history: [],
    connections: [
      [0, 1, 30000],
      [1, 2, 30000],
      [2, 3, 200000],
      [3, 4, 30000],
      [4, 5, 30000],
    ].map(([a, b, cost]) => ({
      from: `c${a}`,
      to: `c${b}`,
      distance: cost,
      travelCost: cost,
      kind: "land",
    })),
    politics: {
      polities: [
        {
          id: "polity",
          seat: "c0",
          support: 1,
          status: "active",
          claims: communities.map((c) => c.id),
          causes: [],
        },
      ],
      control: Object.fromEntries(communities.map((c) => [c.id, "polity"])),
      sovereignty: {},
      contested: {},
      history: [],
    },
  };
  world.entities.polity = {
    id: "polity",
    name: "Country",
    kind: "polity",
    state: "generated",
    attributes: {},
    relations: [],
  };
  state.society = {
    region,
    owner: residentBand("int32", new Int32Array(10)),
    mediumChanged: new Set(),
    river: residentBand("float64", new Float64Array(10)),
    coast: residentBand("float64", new Float64Array(10)),
    inherited: false,
    changed: new Set(),
  };
  world.societies = { area: region };
  const context: MapProcessContext = {
    scope: state.domain.scope,
    invocation: [],
    parameters: {},
    epochs: [],
    epochIndices: [],
    causes: [],
    random: () => 0.5,
    cancelled: () => false,
    progress() {},
    recordCause() {},
  };
  return { state, world, region, context, communities };
}

it("derives political and regional centers from occupation and connected hinterlands", () => {
  const { region } = fixture();
  const hierarchy = settlementHierarchy(region);
  expect(hierarchy.get("c0")?.settlementRole).toBe("capital");
  expect(hierarchy.get("c3")?.settlementRole).toBe("regionalCapital");
  expect(hierarchy.get("c6")?.settlementRole).toBe("settlement"); // populous but disconnected
  region.politics!.polities[0].status = "collapsed";
  expect(settlementHierarchy(region).get("c0")?.capitalOf).toEqual([]);
});

it("moves a lost seat to a reachable inhabited center and preserves authored seats", () => {
  const { state, world, region, communities } = fixture();
  communities[0].status = "ruined";
  relocatePolitySeats(state, "Disaster");
  expect(region.politics!.polities[0].seat).toBe("c3");
  expect(world.entities.polity.attributes.center).toEqual(communities[3].position);
  world.entities.polity.state = "authored";
  communities[3].status = "ruined";
  relocatePolitySeats(state, "Later");
  expect(region.politics!.polities[0].seat).toBe("c3");
});

it("publishes only major global items while retaining latent society for explicit regional development", () => {
  const { state, world, region, context, communities } = fixture();
  const work = makeWork(state, communities[1], "conservation");
  region.works.push(work);
  const before = structuredClone(region);
  publishSettlements(state, context);
  publishCultures(state);
  const features = Object.values(world.features);
  expect(
    features.filter((f) => f.kind === "settlement").map((f) => f.attributes.communityId)
  ).toEqual(["c0", "c3", "c6"]);
  expect(
    features.some((f) => ["conservation", "institution", "culturalOrigin"].includes(f.kind))
  ).toBe(false);
  expect(region).toEqual(before);
  world.areas.child = { ...world.areas.area, id: "child", parentId: "area", profile: "region" };
  state.domain.scope = { ...state.domain.scope, areaId: "child" };
  // A demand is not a feature at any profile; the child realizes it on c1's land first.
  state.society!.owner.fill(1, 5);
  realizeDemands(state);
  const realized = structuredClone(region);
  publishSettlements(state, { ...context, scope: state.domain.scope });
  const localWork = Object.values(world.features).find((f) => f.attributes.workId === work.id)!;
  expect(localWork).toMatchObject({ kind: "conservation", layerId: "landUse", areaId: "child" });
  expect(
    Object.values(world.features).find(
      (f) => f.attributes.communityId === "c1" && f.kind === "settlement"
    )?.areaId
  ).toBe("child");
  // Publication itself changes no society record; only realization did.
  expect(region).toEqual(realized);
});
