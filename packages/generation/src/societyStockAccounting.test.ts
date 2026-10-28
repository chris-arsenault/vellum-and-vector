import { expect, it } from "vitest";
import {
  canonryMagicPresets,
  gridPosition,
  putChannel,
  type SocietyCommunity,
  type SocietyMagicPractice,
} from "@atlas/domain";
import { landscape } from "./mapFixtures";
import type { MapProcessContext } from "./process";
import { useSocietyMagic } from "./societyMagic";
import { createAdaptiveWorldMesh } from "./canonry/adaptiveMesh";
import { createField } from "./canonry/field";
import { nearestTriangle } from "./canonry/mesh";
import { atlasPhysicalProfile } from "./canonry/atlasProfile";
import { initializeMagic, reservoirAmount, stockKey } from "./canonry/magicState";

const coreAmount = 10_000_000; // Stock units per core-equivalent in the practice ledger.
const ledgers = ["coreSupply", "seed", "salt"] as const;

function practice(communityId: string): SocietyMagicPractice {
  return {
    communityId,
    coreDeposit: 0,
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
    seed: 0,
    salt: 0,
  };
}
function fixture() {
  const state = landscape(),
    count = state.surface.active.length;
  state.domain.world.id = "bc07dcd0-7cba-46b1-8e56-5f7829dde8cb";
  state.domain.world.magicSystems = [];
  putChannel(state.surface, "temperature", "celsius", new Float64Array(count).fill(20));
  const communities: SocietyCommunity[] = [1, 3].map((sample, i) => ({
    id: `town-${i}`,
    name: `Town ${i}`,
    position: gridPosition(state.surface, sample),
    areaKm2: 1,
    groups: [
      {
        people: "residents",
        culture: null,
        languages: [],
        religions: [],
        practices: [],
        count: 1000,
      },
    ],
    support: { farming: 1000, grazing: 0, gathering: 0, fishing: 0, water: 1, capacity: 1000 },
    founded: "Settlement",
    status: "inhabited",
    protected: false,
    causes: [],
  }));
  state.society = {
    region: {
      areaId: state.domain.scope.areaId,
      spaceId: state.domain.scope.spaceId,
      communities,
      connections: [],
      history: [],
      works: [],
      events: [],
      magic: communities.map((c) => practice(c.id)),
    },
    owner: new Int32Array(count),
    river: new Float64Array(count),
    coast: new Float64Array(count),
    inherited: false,
    changed: new Set(),
    mediumChanged: new Set(),
  };
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
  return { state, context, region: state.society.region };
}
function tradeFixture(wear = 1000, travelCost = 10_000) {
  const f = fixture(),
    [a, b] = f.region.communities;
  f.region.connections = [
    { from: a.id, to: b.id, distance: travelCost, travelCost, kind: "land", wear },
  ];
  for (const ledger of ledgers) f.region.magic[0][ledger] = 100;
  return f;
}
it.each([0, 10, 60, 80, 100])(
  "conserves nonnegative inventories over a %i-year trade cycle",
  (years) => {
    const { state, context, region } = tradeFixture(),
      people = structuredClone(region.communities.map((c) => c.groups)),
      elevation = state.surface.channels.elevation.slice(),
      connection = structuredClone(region.connections);
    useSocietyMagic(state, context, years);
    for (const ledger of ledgers) {
      const [a, b] = region.magic.map((p) => p[ledger] ?? 0);
      const consumed =
        ledger === "coreSupply" ? region.magic.reduce((n, p) => n + p.coreUsed, 0) : 0;
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(a).toBeGreaterThanOrEqual(b);
      expect(a + b + consumed).toBeCloseTo(100, 10);
    }
    expect(region.communities.map((c) => c.groups)).toEqual(people);
    expect(state.surface.channels.elevation).toEqual(elevation);
    expect(region.connections).toEqual(connection);
  }
);
it("moves the same seed and salt over one long cycle or several short cycles", () => {
  const whole = tradeFixture(),
    split = tradeFixture();
  useSocietyMagic(whole.state, whole.context, 60);
  for (let i = 0; i < 6; i++) useSocietyMagic(split.state, split.context, 10);
  for (const ledger of ["seed", "salt"] as const)
    for (let i = 0; i < 2; i++)
      expect(split.region.magic[i][ledger]).toBeCloseTo(whole.region.magic[i][ledger]!, 10);
});
it("moves more stock along a worn or nearby way while keeping a closed way unchanged", () => {
  const flows = [tradeFixture(0), tradeFixture(), tradeFixture(1000, 500_000), tradeFixture()];
  flows[3].region.connections = [];
  for (const f of flows) useSocietyMagic(f.state, f.context, 10);
  const sent = flows.map((f) => f.region.magic[1].seed!);
  expect(sent[1]).toBeGreaterThan(sent[0]);
  expect(sent[1]).toBeGreaterThan(sent[2]);
  expect(sent[3]).toBe(0);
});

function miningFixture(availableCores: number) {
  const f = fixture(),
    { state } = f;
  state.domain.world.magicSystems = canonryMagicPresets().map((s) => ({
    ...s,
    enabled: s.id === "fire",
  }));
  putChannel(
    state.surface,
    "magic:fire:intensity",
    "relative-intensity",
    new Float64Array(state.surface.active.length).fill(1000)
  );
  const map = createField(
    createAdaptiveWorldMesh(
      [0, 0, 4000, 1000],
      { maximumSize: 1000, minimumSize: 1000, refine: () => false },
      0
    )
  );
  const samples = Int32Array.from(state.surface.active, (_, i) => {
    const p = gridPosition(state.surface, i);
    return nearestTriangle(map.mesh, p.x - map.mesh.origin[0], p.y - map.mesh.origin[1]);
  });
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    samples,
    fixed: [],
    inherited: false,
    sampling: { maximumSize: 1000, minimumSize: 1000, featureSamples: 2 },
  };
  initializeMagic(state);
  const fire = state.physical.magic!.fields.find((field) => field.definition.id === "fire")!,
    origin = fire.definition.origins.find((o) => o.stocks.some((s) => s.reservoir === "held"))!,
    stock = origin.stocks.find((s) => s.reservoir === "held")!,
    held = fire.stocks[stockKey(origin, stock)],
    cell = samples[1],
    other = (cell + 1) % held.length;
  held.set(cell, availableCores * coreAmount);
  held.set(other, 7 * coreAmount);
  f.region.magic[0].coreDeposit = 100; // A retained estimate must not override the live reservoir.
  return { ...f, fire, held, cell, other };
}
it.each([0, 2, 100])("backs mining and forging with the %i available live cores", (available) => {
  const { state, context, region, fire, held, cell, other } = miningFixture(available),
    elevation = state.surface.channels.elevation.slice();
  useSocietyMagic(state, context, 10);
  const p = region.magic[0],
    extracted = Math.min(20, available),
    used = Math.min(5, extracted);
  expect(p.coreDeposit).toBeCloseTo(100 - extracted, 10);
  expect(p.coreSupply).toBeCloseTo(extracted - used, 10);
  expect(p.coreUsed).toBeCloseTo(used, 10);
  expect(held.get(cell)).toBeCloseTo((available - extracted) * coreAmount, 5);
  expect(held.get(other)).toBe(7 * coreAmount);
  expect(reservoirAmount(fire, "forge", cell)).toBeCloseTo(used * coreAmount, 5);
  expect(
    held.get(cell) + reservoirAmount(fire, "forge", cell) + p.coreSupply * coreAmount
  ).toBeCloseTo(available * coreAmount, 5);
  expect(fire.lost).toBeCloseTo(p.coreSupply * coreAmount, 5);
  expect(state.surface.channels.elevation).toEqual(elevation);
});
it("cannot mine a depleted reservoir again or mine the cores already cracked at its forge", () => {
  const { state, context, region, fire, cell } = miningFixture(2);
  useSocietyMagic(state, context, 10);
  const used = region.magic[0].coreUsed;
  for (let i = 0; i < 6; i++) useSocietyMagic(state, context, 10);
  expect(region.magic[0].coreUsed).toBe(used);
  expect(region.magic[0].coreSupply).toBe(0);
  expect(reservoirAmount(fire, "forge", cell)).toBe(2 * coreAmount);
  expect(reservoirAmount(fire, "held", cell)).toBe(0);
});
it("still consumes a finite society-only deposit without a live material field", () => {
  const { state, context, region } = fixture();
  region.magic[0].coreDeposit = 2;
  for (let i = 0; i < 3; i++) useSocietyMagic(state, context, 10);
  expect(region.magic[0].coreDeposit).toBe(0);
  expect(region.magic[0].coreUsed).toBe(2);
  expect(region.magic[0].coreSupply).toBe(0);
});
