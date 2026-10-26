import { expect, it } from "vitest";
import {
  canonryMagicPresets,
  gridPosition,
  population,
  putChannel,
  type SocietyCommunity,
} from "@atlas/domain";
import { landscape, epoch } from "./mapFixtures";
import type { MapProcessContext } from "./process";
import { initializePopulation } from "./societyPopulation";
import { useSocietyMagic } from "./societyMagic";
import { applySocietyWorks } from "./societyWorks";
import { besiegeLost } from "./societySiege";
import { recordSocietyOnMesh } from "./societyRecord";
import { resolveSocietyHazards } from "./societyHazards";
import { refreshSocietyConnections } from "./societyGeography";
import { wearWays } from "./societyWays";
import { nearestSample } from "./societySpatial";
import { atlasChannels } from "./canonry/atlasChannels";
import { createAdaptiveWorldMesh } from "./canonry/adaptiveMesh";
import { createField } from "./canonry/field";
import { nearestTriangle } from "./canonry/mesh";
import { atlasPhysicalProfile } from "./canonry/atlasProfile";
import { initializeMagic, reservoirAmount } from "./canonry/magicState";
import { locateMagicSources } from "./canonry/magicSources";
import { propagateMagic } from "./canonry/magicPropagation";

/**
 * Two communities on the landscape fixture, a way between them, and a live mesh under the
 * surface so people's draws and deposits land on cells the magic systems read.
 */
function fixture() {
  const state = landscape();
  state.domain.world.id = "bc07dcd0-7cba-46b1-8e56-5f7829dde8cb";
  state.domain.world.areas.area.profile = "local";
  const n = state.surface.active.length;
  const set = (name: string, value: number, unit = "ratio") =>
    putChannel(state.surface, name, unit, new Float64Array(n).fill(value));
  set("elevation", 100, "metre");
  set("grazers", 1);
  set("browsers", 1);
  set("herbivores", 2);
  set("treeCover", 0.7);
  set("broadleafCover", 0.7);
  set("grassCover", 0.1);
  set("soilWater", 0.02, "metre");
  set("soilDepth", 0.5, "metre");
  const context: MapProcessContext = {
    scope: state.domain.scope,
    invocation: [],
    parameters: {},
    epochs: [epoch("Settlement", 200)],
    epochIndices: [0],
    causes: [],
    recordCause() {},
    random: () => 0.5,
    cancelled: () => false,
    progress() {},
  };
  initializePopulation(state, context);
  state.domain.world.magicSystems = canonryMagicPresets();
  const map = createField(
    createAdaptiveWorldMesh(
      [0, 0, 4000, 1000],
      { maximumSize: 1000, minimumSize: 1000, refine: () => true },
      0
    )
  );
  map.WaterKindCodes.fill(0);
  map.Temperature.fill(290);
  map.RockResistance.fill(1000);
  const samples = Int32Array.from(state.surface.active, (_active, i) => {
    const p = gridPosition(state.surface, i);
    return nearestTriangle(map.mesh, p.x - map.mesh.origin[0], p.y - map.mesh.origin[1]);
  });
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    samples,
    fixed: [],
    inherited: false,
    sampling: { maximumSize: map.mesh.spacing, minimumSize: map.mesh.spacing, featureSamples: 2 },
  };
  initializeMagic(state);
  const region = state.society!.region,
    [a, b] = region.communities;
  for (const c of region.communities) {
    c.groups[0].count = 2000;
    c.status = "inhabited";
    c.settlement = { population: 1500, peak: 1500, recoveryYears: 0 };
  }
  region.connections = [
    { from: a.id, to: b.id, distance: 2000, travelCost: 2000, kind: "land", wear: 500 },
  ];
  const cellOf = (c: SocietyCommunity) => samples[nearestSample(state, c.position)];
  const field = (id: string) => state.physical!.magic!.fields.find((f) => f.definition.id === id)!;
  expect(cellOf(a)).not.toBe(cellOf(b));
  return { state, context, a, b, cellOf, field, map, region };
}
const practice = (state: ReturnType<typeof fixture>["state"], id: string) =>
  state.society!.region.magic.find((p) => p.communityId === id)!;

it("carries mined cores down the road to a city with no vein, whose forge becomes a Fire source", () => {
  const run = (connected: boolean) => {
    const { state, context, a, b, cellOf, field, region } = fixture();
    if (!connected) region.connections = [];
    useSocietyMagic(state, context, 10);
    practice(state, a.id).coreDeposit = 500;
    const fire = field("fire");
    fire.stocks["vein/held"][cellOf(a)] = 500 * 10_000_000;
    for (let cycle = 0; cycle < 20; cycle++) useSocietyMagic(state, context, 10);
    locateMagicSources(state, fire, 1, 0);
    propagateMagic(state, fire, 1, 1);
    return { used: practice(state, b.id).coreUsed, fire, cell: cellOf(b), state };
  };
  const traded = run(true);
  expect(traded.used).toBeGreaterThan(0);
  expect(traded.fire.stocks["forge/cracked"][traded.cell]).toBeGreaterThan(0);
  expect(traded.fire.originSources.forge[traded.cell]).toBeGreaterThan(0);
  expect(traded.fire.intensity[traded.cell]).toBeGreaterThan(0);
  expect(traded.state.society!.magicTouched!.has("fire")).toBe(true);
  const alone = run(false);
  expect(alone.used).toBe(0);
  expect(alone.fire.stocks["forge/cracked"][alone.cell]).toBe(0);
  expect(alone.fire.originSources.forge[alone.cell]).toBe(0);
});

it("gathers seed on a Deepwood seat, trades it down the road and plants a grove at the market", () => {
  const run = (connected: boolean) => {
    const { state, context, a, b, cellOf, field, map, region } = fixture();
    if (!connected) region.connections = [];
    const greenwood = field("greenwood"),
      sap = greenwood.stocks["stand/sap"];
    sap[cellOf(a)] = 600 * map.mesh.areas[cellOf(a)];
    for (let cycle = 0; cycle < 20; cycle++) useSocietyMagic(state, context, 10);
    const planted = sap[cellOf(b)];
    locateMagicSources(state, greenwood, 1, 0);
    return { planted, grove: greenwood.originSources.stand[cellOf(b)], state };
  };
  const traded = run(true);
  expect(traded.planted).toBeGreaterThan(0);
  expect(traded.grove).toBeGreaterThan(0);
  expect(traded.state.society!.magicTouched!.has("greenwood")).toBe(true);
  const alone = run(false);
  expect(alone.planted).toBe(0);
  expect(alone.grove).toBe(0);
});

it("hunts the herds Greenwood's carrier reads and clears ground wetter and emptied of sap", () => {
  const { state, context, a, cellOf, field, map } = fixture();
  const sample = nearestSample(state, a.position),
    sap = field("greenwood").stocks["stand/sap"],
    before = 600 * map.mesh.areas[cellOf(a)];
  sap[cellOf(a)] = before;
  for (const c of state.society!.region.communities)
    c.support = { farming: 100, grazing: 0, gathering: 0, fishing: 0, water: 1, capacity: 100 };
  applySocietyWorks(state, context, 50);
  const kinds = state.society!.region.works.map((w) => w.kind);
  expect(kinds).toContain("hunting");
  expect(kinds).toContain("clearance");
  expect(state.surface.channels.grazers[sample]).toBeLessThan(1);
  expect(state.surface.channels.treeCover[sample]).toBeLessThan(0.7);
  expect(state.surface.channels.soilWater[sample]).toBeGreaterThan(0.02);
  expect(sap[cellOf(a)]).toBeLessThan(before);
  expect(state.society!.magicTouched!.has("greenwood")).toBe(true);
  // The herds and cover edited here are the mesh fields the ecology and the gut carrier read.
  expect(atlasChannels.find((binding) => binding.name === "grazers")?.native).toBe("Grazers");
  expect(atlasChannels.find((binding) => binding.name === "soilWater")?.native).toBe("SoilWater");
});

it("besieges the towns a fallen polity lost and records the dead, the tenure and the walked way", () => {
  const { state, a, b, cellOf, map, region } = fixture();
  // At World a siege's footprint is the unit's own country, so only the besieged town falls.
  state.domain.world.areas.area.profile = "world";
  region.politics = {
    polities: [
      { id: "P", seat: a.id, support: 0, status: "collapsed", claims: [a.id, b.id], causes: [] },
    ],
    sovereignty: {},
    control: { [b.id]: "P" },
    contested: {},
    history: [],
  };
  besiegeLost(state, region.politics.polities[0], "active", "Settlement");
  expect(region.events.map((e) => e.kind)).toEqual(["siege"]);
  const siege = region.events[0];
  expect(siege.casualties).toBeGreaterThan(0);
  expect(siege.communities).toEqual([a.id]);
  expect(a.status).toBe("ruined");
  expect(b.status).toBe("inhabited");
  state.society!.dieOff!.set(b.id, 50);
  recordSocietyOnMesh(state, 10);
  expect(map.MassDeath[cellOf(a)]).toBeCloseTo(siege.casualties, 6);
  expect(map.MassDeath[cellOf(b)]).toBe(50);
  // New dead: the system made of them is re-evaluated at the next refresh.
  expect(state.society!.magicTouched!.has("salt")).toBe(true);
  expect(map.Tenure[cellOf(a)]).toBe(0);
  expect(map.Tenure[cellOf(b)]).toBeCloseTo(population(b) * 10, 6);
  expect(map.WalkedRoute[cellOf(a)]).toBe(5000);
  expect(map.WalkedRoute[cellOf(b)]).toBe(5000);
  // The event's dead are recorded once; tenure and the way keep accruing.
  recordSocietyOnMesh(state, 10);
  expect(map.MassDeath[cellOf(a)]).toBeCloseTo(siege.casualties, 6);
  expect(map.MassDeath[cellOf(b)]).toBe(50);
  expect(map.Tenure[cellOf(b)]).toBeCloseTo(population(b) * 20, 6);
  expect(map.WalkedRoute[cellOf(b)]).toBe(10000);
});

it("rakes the pan under a seat, trades the salt down the road and lays it where it is sold", () => {
  const run = (connected: boolean) => {
    const { state, context, a, b, cellOf, field, map, region } = fixture();
    if (!connected) region.connections = [];
    const salt = field("salt");
    salt.stocks["dead-lake/bed"][cellOf(a)] = 600 * map.mesh.areas[cellOf(a)];
    for (let cycle = 0; cycle < 20; cycle++) useSocietyMagic(state, context, 10);
    return {
      laid: reservoirAmount(salt, "bed", cellOf(b)),
      raked: practice(state, a.id).salt ?? 0,
      state,
    };
  };
  const traded = run(true);
  expect(traded.laid).toBeGreaterThan(0);
  expect(traded.state.society!.magicTouched!.has("salt")).toBe(true);
  const alone = run(false);
  expect(alone.laid).toBe(0);
  expect(alone.raked).toBeGreaterThan(0);
});

it("keeps the frontier at both seats of a way two polities hold, and forgets an unkept line", () => {
  const { state, a, b, cellOf, map, region } = fixture();
  region.politics = {
    polities: [
      { id: "P", seat: a.id, support: 1, status: "active", claims: [a.id], causes: [] },
      { id: "Q", seat: b.id, support: 1, status: "active", claims: [b.id], causes: [] },
    ],
    sovereignty: {},
    control: { [a.id]: "P", [b.id]: "Q" },
    contested: {},
    history: [],
  };
  recordSocietyOnMesh(state, 10);
  expect(map.KeptLine[cellOf(a)]).toBe(10);
  expect(map.KeptLine[cellOf(b)]).toBe(10);
  // The frontier falls to one polity: the line is no longer kept and fades.
  region.politics.control[b.id] = "P";
  recordSocietyOnMesh(state, 10);
  expect(map.KeptLine[cellOf(a)]).toBeCloseTo(10 * Math.exp(-10 / 150), 9);
});

it("connects two communities through a Veil door at the crossing cost, without wearing it", () => {
  const { state, a, b, cellOf, field, region } = fixture();
  const veil = field("veil");
  veil.doors = [{ a: cellOf(a), b: cellOf(b) }];
  veil.definition.parameters.doorTravel = 100;
  refreshSocietyConnections(state);
  const door = region.connections.find((link) => link.kind === "door");
  expect(door).toBeDefined();
  expect(new Set([door!.from, door!.to])).toEqual(new Set([a.id, b.id]));
  expect(door!.travelCost).toBeLessThan(2000);
  state.society!.traffic = new Float64Array(region.connections.length).fill(5000);
  wearWays(state, 10);
  expect(door!.travelCost).toBe(door!.distance);
});

it("kills where a confluence covers the ground a community stands on", () => {
  const { state, context, region } = fixture();
  putChannel(
    state.surface,
    "magic:confluence:war:coverage",
    "ratio",
    new Float64Array(state.surface.active.length).fill(1)
  );
  resolveSocietyHazards(state, context, 5000);
  const rims = region.events.filter((e) => e.kind === "thermal-fracture");
  expect(rims.length).toBeGreaterThan(0);
  expect(rims.reduce((sum, e) => sum + e.casualties, 0)).toBeGreaterThan(0);
});
