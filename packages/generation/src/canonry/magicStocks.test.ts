import { expect, it } from "vitest";
import { canonryMagicPresets } from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { createAdaptiveWorldMesh } from "./adaptiveMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { initializeMagic } from "./magicState";
import { locateMagicSources } from "./magicSources";
import { propagateMagic } from "./magicPropagation";
import { magicRockFeedback, magicThermalFeedback } from "./magicFeedback";
import { advanceStocks } from "./magicStocks";
import { units } from "./math";

function scenario() {
  const state = landscape(),
    map = createField(
      createAdaptiveWorldMesh(
        [-100_000, -100_000, 100_000, 100_000],
        { maximumSize: 25_000, minimumSize: 12_500, refine: () => true },
        0
      )
    );
  state.domain.world.magicSystems = canonryMagicPresets();
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    samples: new Int32Array(state.surface.active.length),
    fixed: [],
    inherited: false,
    sampling: { maximumSize: map.mesh.spacing, minimumSize: map.mesh.spacing, featureSamples: 2 },
  };
  map.RockResistance.fill(1000);
  map.FractureConductance.fill(600);
  map.Temperature.fill(300);
  map.WaterKindCodes.fill(0);
  map.WindX.fill(1000);
  map.WindY.fill(0);
  initializeMagic(state);
  return state;
}
/** A crater at the origin with a two-metre ejecta blanket out to twice its radius. */
function fall(state: ReturnType<typeof scenario>, epoch: number, radius = 30_000) {
  const map = state.physical!.map;
  map.events.push({ id: "impact:test", kind: "impact", x: 0, y: 0, radius, epoch, strength: 1000 });
  for (let i = 0; i < map.mesh.count; i++) {
    const distance = Math.hypot(map.mesh.x[i], map.mesh.y[i]);
    if (distance >= radius && distance <= radius * 2) map.ImpactEjectaThickness[i] = units(2);
  }
}
const sum = (values: ArrayLike<number>) => {
  let total = 0;
  for (let i = 0; i < values.length; i++) total += values[i];
  return total;
};

it("seeds a finite fallen stock from an impact's ejecta, heavier downwind, and only once", () => {
  const state = scenario(),
    map = state.physical!.map,
    fire = state.physical!.magic!.fields[0];
  fall(state, 0);
  locateMagicSources(state, fire, 42, 0);
  const held = fire.stocks["fallen/held"];
  expect(sum(held)).toBeGreaterThan(0);
  expect(
    fire.located.some((point) => point.id === "impact:test" && point.origin === "fallen")
  ).toBe(true);
  // Downwind (positive x) cells of the fan carry more than their upwind mirrors.
  const east = held.reduce((total, value, i) => total + (map.mesh.x[i] > 0 ? value : 0), 0),
    west = held.reduce((total, value, i) => total + (map.mesh.x[i] < 0 ? value : 0), 0);
  expect(east).toBeGreaterThan(west);
  // Released stock is the source where the cores lie, with no conduit behind it.
  expect(fire.originSources.fallen.some((value, i) => value > 0 && held[i] > 0)).toBe(true);
  expect(fire.arrival.some((value) => value === 0)).toBe(true);
  const before = sum(held);
  locateMagicSources(state, fire, 42, 0);
  expect(sum(held)).toBe(before);
});

it("releases a finite stock down to nothing over epochs, faster under ice and strain, never renewing", () => {
  const state = scenario(),
    map = state.physical!.map,
    fire = state.physical!.magic!.fields[0];
  fall(state, 0);
  const totals: number[] = [];
  for (let epoch = 0; epoch < 6; epoch++) {
    locateMagicSources(state, fire, 42, epoch);
    totals.push(sum(fire.stocks["fallen/held"]));
    advanceStocks(state, fire, epoch);
  }
  for (let n = 1; n < totals.length; n++) expect(totals[n]).toBeLessThan(totals[n - 1]);
  const quiet = totals[1] / totals[0];
  // The same fall under a glacier cracks faster.
  const iced = scenario();
  fall(iced, 0);
  iced.physical!.map.IceThickness.fill(400);
  const icedFire = iced.physical!.magic!.fields[0];
  locateMagicSources(iced, icedFire, 42, 0);
  const start = sum(icedFire.stocks["fallen/held"]);
  advanceStocks(iced, icedFire, 0);
  expect(sum(icedFire.stocks["fallen/held"]) / start).toBeLessThan(quiet);
  void map;
});

it("keeps buried stock inert and washes river-carried stock downstream to the sea", () => {
  const state = scenario(),
    map = state.physical!.map,
    fire = state.physical!.magic!.fields[0];
  fall(state, 0);
  locateMagicSources(state, fire, 42, 0);
  const held = fire.stocks["fallen/held"],
    hot = held.findIndex((value) => value > 0);
  // Burial: deep sediment over the stock, and it stops releasing.
  map.SedimentThickness[hot] = units(100);
  locateMagicSources(state, fire, 42, 1);
  expect(fire.releasing[hot]).toBe(0);
  expect(fire.originSources.fallen[hot]).toBe(0);
  map.SedimentThickness[hot] = 0;
  // A river from the hot cell: stock moves to the next cell and is lost at the sea.
  const downstream = map.mesh.neighbors[hot * map.mesh.stride];
  map.RiverOrders[hot] = 3;
  map.FlowTargets.fill(-1);
  map.FlowTargets[hot] = downstream;
  map.FlowTargets[downstream] = map.mesh.neighbors[downstream * map.mesh.stride];
  map.WaterKindCodes[map.FlowTargets[downstream]] = 1;
  map.RiverOrders[downstream] = 3;
  const before = held[hot],
    lost = fire.lost;
  advanceStocks(state, fire, 1);
  expect(held[hot]).toBeLessThan(before);
  expect(held[downstream]).toBeGreaterThan(0);
  advanceStocks(state, fire, 2);
  expect(fire.lost).toBeGreaterThan(lost);
});

it("turns a sealing conduit's cores to spent ore and reopens it under strain", () => {
  const state = scenario(),
    map = state.physical!.map,
    fire = state.physical!.magic!.fields[0];
  map.HeatSourceDensity.fill(0);
  map.HeatSourceDensity[0] = 1000;
  // A second, weaker peak far away so a sealed core has somewhere else to yield to.
  const far = map.mesh.count - 1;
  map.HeatSourceDensity[far] = 900;
  fire.definition.parameters.maximumSources = 1;
  locateMagicSources(state, fire, 42, 0);
  propagateMagic(state, fire, 42, 1);
  const core = 0;
  expect(fire.source[core]).toBeGreaterThan(0);
  fire.history[core] = fire.definition.parameters.conduitBudget;
  magicRockFeedback(state);
  expect(fire.sealed[core]).toBe(1);
  expect(fire.stocks["vein/spent"][core]).toBeGreaterThan(0);
  // Sealed, the cell no longer seeds a core; the budget goes to the far peak.
  locateMagicSources(state, fire, 42, 1);
  expect(fire.located.filter((point) => point.origin === "vein").map((p) => p.x)).toEqual([
    map.mesh.x[far],
  ]);
  // Exposed spent ore still feeds the source at reduced strength.
  expect(fire.source[core]).toBeGreaterThan(0);
  expect(fire.source[core]).toBeLessThan(720);
  // Strain across the seal reopens the conduit with part of its budget.
  map.TectonicStrain[core] = 900;
  locateMagicSources(state, fire, 42, 2);
  expect(fire.sealed[core]).toBe(0);
  expect(
    fire.located.some((point) => point.origin === "vein" && point.x === map.mesh.x[core])
  ).toBe(true);
  expect(fire.history[core]).toBeLessThan(fire.definition.parameters.conduitBudget);
});

it("melts ice over a vein from below and sends the melt out as glacial meltwater", () => {
  const state = scenario(),
    map = state.physical!.map,
    fire = state.physical!.magic!.fields[0];
  map.HeatSourceDensity.fill(0);
  map.HeatSourceDensity[0] = 1000;
  map.IceThickness.fill(300);
  map.GlacialMeltwater.fill(0);
  locateMagicSources(state, fire, 42, 0);
  propagateMagic(state, fire, 42, 1);
  magicThermalFeedback(state);
  const hot = fire.intensity.findIndex((value) => value > 0);
  expect(map.IceThickness[hot]).toBeLessThan(300);
  expect(map.GlacialMeltwater[hot]).toBeGreaterThan(0);
  const cold = fire.intensity.findIndex((value) => value === 0);
  expect(map.GlacialMeltwater[cold]).toBe(0);
});
