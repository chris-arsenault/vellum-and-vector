import { expect, it } from "vitest";
import {
  communityPractices,
  putChannel,
  residentBand,
  withPracticeShares,
  type SocietyMagicPractice,
} from "@atlas/domain";
import { landscape, epoch } from "./mapFixtures";
import type { MapProcessContext } from "./process";
import { initializePopulation } from "./societyPopulation";
import { refreshSocietySupport } from "./societyGeography";
import { useSocietyMagic } from "./societyMagic";
import { coastalFishery } from "./societySupport";
import { fishWaters, learnPractices, realizedPractices } from "./societyPractices";

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
  for (const c of state.society!.region.communities) c.groups[0].count = 1000;
  return { state, context };
}
const support = (farming: number, fishing: number) => ({
  farming,
  grazing: 0,
  gathering: 0,
  fishing,
  water: 1,
  capacity: farming + fishing,
});

it("learns livelihoods from what each country yields and forgets them when it stops", () => {
  const { state, context } = fixture(),
    [coast, inland] = state.society!.region.communities;
  coast.support = support(0, 100);
  inland.support = support(100, 0);
  for (let cycle = 0; cycle < 40; cycle++) learnPractices(state, context, 10);
  expect(communityPractices(coast.groups).fishing).toBeGreaterThan(0.9);
  expect(communityPractices(coast.groups).farming).toBeUndefined();
  expect(communityPractices(inland.groups).farming).toBeGreaterThan(0.9);
  // The sea fails: the fishers turn to the fields over a few generations, not at once.
  coast.support = support(100, 0);
  learnPractices(state, context, 10);
  expect(communityPractices(coast.groups).fishing).toBeGreaterThan(0.8);
  for (let cycle = 0; cycle < 60; cycle++) learnPractices(state, context, 10);
  expect(communityPractices(coast.groups).fishing ?? 0).toBeLessThan(0.02);
  expect(communityPractices(coast.groups).farming).toBeGreaterThan(0.95);
});

it("reads magic practice from the ledger and keeps authored practices as records", () => {
  const { state, context } = fixture(),
    c = state.society!.region.communities[0];
  c.support = support(100, 0);
  c.groups[0].practices = ["conservation"];
  const ledger: SocietyMagicPractice = {
    communityId: c.id,
    coreDeposit: 10,
    coreSupply: 0,
    coreUsed: 1,
    heatApplied: 4,
    crystals: 0,
    charge: 0,
    readers: 0,
    memoryAccess: 0,
    pressureCharge: 0,
    pressureUsed: 0,
    maritimeContact: 0,
    divers: 0,
    depthLimit: 200,
    injuries: 0,
    strain: 0,
  };
  expect(realizedPractices(c, ledger)).toEqual({ farming: 1, "fire-forge": 0.5 });
  state.society!.region.magic = [ledger];
  for (let cycle = 0; cycle < 80; cycle++) learnPractices(state, context, 10);
  const shares = communityPractices(c.groups);
  expect(shares["fire-forge"]).toBeCloseTo(0.5, 2);
  expect(shares.conservation).toBe(1);
  expect(c.groups[0].practices).toContain("conservation");
});

it("raises a skilled livelihood's yield by half and the capacity with it, per channel", () => {
  const { state } = fixture(),
    [a, b] = state.society!.region.communities;
  refreshSocietySupport(state);
  const before = structuredClone([a.support, b.support]);
  expect(before[0].farming).toBeGreaterThan(0);
  a.groups = a.groups.map((g) => withPracticeShares(g, { farming: 1 }));
  refreshSocietySupport(state);
  expect(a.support.farming).toBeCloseTo(before[0].farming * 1.5, 9);
  expect(a.support.grazing).toBeCloseTo(before[0].grazing, 9);
  expect(a.support.gathering).toBeCloseTo(before[0].gathering, 9);
  expect(a.support.capacity).toBeGreaterThan(before[0].capacity);
  expect(a.support.capacity).toBeLessThanOrEqual(before[0].capacity * 1.5 + 1e-9);
  expect(b.support).toEqual(before[1]);
});

it("mines more cores with a fire-working people than with the same people unskilled", () => {
  const { state, context } = fixture(),
    [a, b] = state.society!.region.communities;
  a.groups = a.groups.map((g) => withPracticeShares(g, { "fire-forge": 1 }));
  const ledger = (communityId: string): SocietyMagicPractice => ({
    communityId,
    coreDeposit: 1000,
    coreSupply: 0,
    coreUsed: 0,
    heatApplied: 0,
    crystals: 0,
    charge: 0,
    readers: 0,
    memoryAccess: 0,
    pressureCharge: 0,
    pressureUsed: 0,
    maritimeContact: 0,
    divers: 0,
    depthLimit: 200,
    injuries: 0,
    strain: 0,
  });
  state.society!.region.magic = [ledger(a.id), ledger(b.id)];
  useSocietyMagic(state, context, 10);
  const [pa, pb] = state.society!.region.magic;
  expect(1000 - pa.coreDeposit).toBeCloseTo((1000 - pb.coreDeposit) * 1.5, 9);
});

it("takes fish from the sea beside a fishing people's shore and leaves the land alone", () => {
  const { state } = fixture();
  const water = Float64Array.from({ length: 10 }, (_v, i) => Number(i % 5 === 0));
  putChannel(state.surface, "water", "category", residentBand("float64", water));
  putChannel(
    state.surface,
    "aquaticFauna",
    "kg-carbon/square-metre",
    residentBand("float64", new Float64Array(10).fill(1))
  );
  state.society!.coast = coastalFishery(state);
  for (const c of state.society!.region.communities) {
    c.groups = c.groups.map((g) => withPracticeShares(g, { fishing: 1 }));
    c.support.capacity = 1000;
  }
  fishWaters(state, 10);
  const fauna = state.surface.channels.aquaticFauna;
  expect(fauna.get(0)).toBeCloseTo(Math.exp(-10 / 150), 9);
  expect(fauna.get(5)).toBeCloseTo(Math.exp(-10 / 150), 9);
  expect(fauna.get(3)).toBe(1);
  expect(state.society!.changed.has("aquaticFauna")).toBe(true);
  expect(state.society!.mediumChanged.has("aquaticFauna")).toBe(false);
});
