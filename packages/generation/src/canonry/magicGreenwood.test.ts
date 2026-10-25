import { expect, it } from "vitest";
import { canonryMagicPresets } from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { createAdaptiveWorldMesh } from "./adaptiveMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { drawStock, initializeMagic } from "./magicState";
import { locateMagicSources } from "./magicSources";
import { propagateMagic } from "./magicPropagation";
import { magicLivingFeedback } from "./magicFeedback";
import { advanceStocks } from "./magicStocks";
import { groupSuitability, plantGroups } from "./ecologyGroups";
import { neutralEcology } from "./ecologyEnvironment";

function scenario() {
  const state = landscape(),
    map = createField(
      createAdaptiveWorldMesh(
        [-100_000, -100_000, 100_000, 100_000],
        { maximumSize: 10_000, minimumSize: 10_000, refine: () => true },
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
  map.Temperature.fill(400);
  map.WaterKindCodes.fill(0);
  map.IceThickness.fill(0);
  map.RockResistance.fill(1000);
  map.SoilDepth.fill(0.5);
  map.TreeCover.fill(0.7);
  map.BroadleafCover.fill(0.7);
  map.CrustContinentalFraction.fill(900);
  initializeMagic(state);
  const greenwood = state.physical.magic!.fields.find((f) => f.definition.id === "greenwood")!;
  return { state, map, greenwood };
}
const cells = (map: ReturnType<typeof scenario>["map"], test: (x: number, y: number) => boolean) =>
  Array.from(map.mesh.x, (x, i) => i).filter((i) => test(map.mesh.x[i], map.mesh.y[i]));

it("locates stands in old canopy and deep peat and springs on soft rock below a catchment", () => {
  const { state, map, greenwood } = scenario();
  const old = cells(map, (x) => x < -60_000),
    peat = cells(map, (x) => x > 60_000),
    spring = cells(map, (x, y) => Math.abs(x) < 5000 && Math.abs(y) < 5000);
  for (const i of old) map.CanopyAge[i] = 900;
  for (const i of peat) map.PeatCarbon[i] = 20;
  for (const i of spring) {
    map.FlowAccumulation[i] = 80;
    map.RockResistance[i] = 600;
    map.Slope[i] = 0.005;
  }
  locateMagicSources(state, greenwood, 42, 0);
  const stand = greenwood.originSources.stand,
    well = greenwood.originSources.spring;
  expect(old.every((i) => stand[i] > 0)).toBe(true);
  expect(peat.every((i) => stand[i] > 0)).toBe(true);
  expect(spring.every((i) => well[i] > 0 && stand[i] === 0)).toBe(true);
  expect(
    cells(map, (x) => Math.abs(x) < 50_000 && Math.abs(x) > 10_000).every(
      (i) => stand[i] === 0 && well[i] === 0
    )
  ).toBe(true);
  expect(greenwood.located.filter((point) => point.origin === "spring")).toHaveLength(
    spring.length
  );
});

it("spreads between roots through cover and stops at bare rock, water and ice", () => {
  const { state, map, greenwood } = scenario();
  for (const i of cells(map, (x) => x < -80_000)) map.CanopyAge[i] = 900;
  // Three walls east of the stand: bare rock, a lake, and ice.
  for (const i of cells(map, (x) => x > -45_000 && x < -35_000)) {
    map.TreeCover[i] = 0;
    map.BroadleafCover[i] = 0;
    map.SoilDepth[i] = 0.05;
  }
  locateMagicSources(state, greenwood, 42, 0);
  propagateMagic(state, greenwood, 42, 1);
  expect(
    cells(map, (x) => x > -70_000 && x < -50_000).some((i) => greenwood.intensity[i] > 0)
  ).toBe(true);
  expect(cells(map, (x) => x > -30_000).every((i) => greenwood.intensity[i] === 0)).toBe(true);
  for (const i of cells(map, (x) => x > -45_000 && x < -35_000)) {
    map.TreeCover[i] = 0.5;
    map.SoilDepth[i] = 0.5;
    map.WaterKindCodes[i] = 2;
  }
  propagateMagic(state, greenwood, 42, 1);
  expect(cells(map, (x) => x > -30_000).every((i) => greenwood.intensity[i] === 0)).toBe(true);
  for (const i of cells(map, (x) => x > -45_000 && x < -35_000)) {
    map.WaterKindCodes[i] = 0;
    map.IceThickness[i] = 100;
  }
  propagateMagic(state, greenwood, 42, 1);
  expect(cells(map, (x) => x > -30_000).every((i) => greenwood.intensity[i] === 0)).toBe(true);
  for (const i of cells(map, (x) => x > -45_000 && x < -35_000)) map.IceThickness[i] = 0;
  propagateMagic(state, greenwood, 42, 1);
  expect(cells(map, (x) => x > -30_000).some((i) => greenwood.intensity[i] > 0)).toBe(true);
});

it("grows forest past its climate band, establishes on bare ground and braids the river", () => {
  const { state, map, greenwood } = scenario();
  const broadleaf = plantGroups.find((group) => group.id === "broadleaf")!;
  // Too cold for broadleaf by the climate's verdict.
  map.Temperature.fill(230);
  const cold = groupSuitability(map, broadleaf, 0, neutralEcology);
  const green = groupSuitability(map, broadleaf, 0, { ...neutralEcology, verdure: 0.6 });
  expect(cold).toBeLessThan(0.1);
  expect(green).toBeGreaterThan(cold);
  // The living feedback writes verdure from the field and braids a river through it.
  map.Temperature.fill(400);
  greenwood.intensity.fill(0);
  const reach = cells(map, (x) => Math.abs(x) < 15_000);
  for (const i of reach) {
    greenwood.intensity[i] = 800;
    map.RiverOrders[i] = 2;
    map.WetlandCover[i] = 0;
  }
  magicLivingFeedback(state);
  expect(map.Verdure[reach[0]]).toBeCloseTo(0.8, 6);
  expect(map.WetlandCover[reach[0]]).toBeGreaterThanOrEqual(0.4);
  expect(map.FloodplainIntensity[reach[0]]).toBeGreaterThanOrEqual(480);
  const dry = cells(map, (x) => x > 50_000)[0];
  expect(map.Verdure[dry]).toBe(0);
  expect(map.WetlandCover[dry]).toBe(0);
});

it("collapses an overdrawn spring, seals it, and carries sap in the gut toward the herds", () => {
  const { state, map, greenwood } = scenario();
  const spring = cells(map, (x, y) => Math.abs(x) < 5000 && Math.abs(y) < 5000)[0];
  map.FlowAccumulation[spring] = 80;
  map.RockResistance[spring] = 600;
  map.Slope[spring] = 0.005;
  locateMagicSources(state, greenwood, 42, 0);
  const recharge = greenwood.originSources.spring[spring] * map.mesh.areas[spring];
  expect(recharge).toBeGreaterThan(0);
  const bedrock = map.BedrockElevation[spring];
  drawStock(greenwood, spring, recharge * 0.8);
  advanceStocks(state, greenwood, 0);
  expect(greenwood.sealed[spring]).toBe(1);
  expect(map.BedrockElevation[spring]).toBeLessThan(bedrock);
  locateMagicSources(state, greenwood, 42, 1);
  expect(greenwood.originSources.spring[spring]).toBe(0);
  // Herds carry sap to the ground they graze toward.
  const sap = greenwood.stocks["stand/sap"],
    from = cells(map, (x) => x < -80_000)[0],
    neighbour = map.mesh.neighbors[from * map.mesh.stride];
  sap.fill(0);
  sap[from] = 1000;
  map.Grazers.fill(0);
  map.Grazers[from] = 500;
  map.Grazers[neighbour] = 500;
  advanceStocks(state, greenwood, 1);
  expect(sap[from]).toBeLessThan(1000);
  expect(sap[neighbour]).toBeGreaterThan(0);
});

it("leaves no residue when disabled", () => {
  const { state, map, greenwood } = scenario();
  greenwood.definition.enabled = false;
  greenwood.intensity.fill(800);
  magicLivingFeedback(state);
  expect(map.Verdure.every((value) => value === 0)).toBe(true);
});
