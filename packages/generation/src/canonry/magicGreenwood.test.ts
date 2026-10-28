import { expect, it } from "vitest";
import { canonryMagicPresets } from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { createAdaptiveWorldMesh } from "./adaptiveMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { drawReservoir, initializeMagic } from "./magicState";
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
  Array.from({ length: map.mesh.count }, (_, i) => i).filter((i) =>
    test(map.mesh.x(i), map.mesh.y(i))
  );

it("locates stands in old canopy and deep peat and springs on soft rock below a catchment", () => {
  const { state, map, greenwood } = scenario();
  const old = cells(map, (x) => x < -60_000),
    peat = cells(map, (x) => x > 60_000),
    spring = cells(map, (x, y) => Math.abs(x) < 5000 && Math.abs(y) < 5000);
  for (const i of old) map.CanopyAge.set(i, 900);
  for (const i of peat) map.PeatCarbon.set(i, 20);
  for (const i of spring) {
    map.FlowAccumulation.set(i, 80);
    map.RockResistance.set(i, 600);
    map.Slope.set(i, 0.005);
  }
  locateMagicSources(state, greenwood, 42, 0);
  const stand = greenwood.originSources.stand,
    well = greenwood.originSources.spring;
  expect(old.every((i) => stand.get(i) > 0)).toBe(true);
  expect(peat.every((i) => stand.get(i) > 0)).toBe(true);
  expect(spring.every((i) => well.get(i) > 0 && stand.get(i) === 0)).toBe(true);
  expect(
    cells(map, (x) => Math.abs(x) < 50_000 && Math.abs(x) > 10_000).every(
      (i) => stand.get(i) === 0 && well.get(i) === 0
    )
  ).toBe(true);
  expect(greenwood.located.filter((point) => point.origin === "spring")).toHaveLength(
    spring.length
  );
});

it("spreads between roots through cover and stops at bare rock, water and ice", () => {
  const { state, map, greenwood } = scenario();
  for (const i of cells(map, (x) => x < -80_000)) map.CanopyAge.set(i, 900);
  // Three walls east of the stand: bare rock, a lake, and ice.
  for (const i of cells(map, (x) => x > -45_000 && x < -35_000)) {
    map.TreeCover.set(i, 0);
    map.BroadleafCover.set(i, 0);
    map.SoilDepth.set(i, 0.05);
  }
  locateMagicSources(state, greenwood, 42, 0);
  propagateMagic(state, greenwood, 42, 1);
  expect(
    cells(map, (x) => x > -70_000 && x < -50_000).some((i) => greenwood.intensity.get(i) > 0)
  ).toBe(true);
  expect(cells(map, (x) => x > -30_000).every((i) => greenwood.intensity.get(i) === 0)).toBe(true);
  for (const i of cells(map, (x) => x > -45_000 && x < -35_000)) {
    map.TreeCover.set(i, 0.5);
    map.SoilDepth.set(i, 0.5);
    map.WaterKindCodes.set(i, 2);
  }
  propagateMagic(state, greenwood, 42, 1);
  expect(cells(map, (x) => x > -30_000).every((i) => greenwood.intensity.get(i) === 0)).toBe(true);
  for (const i of cells(map, (x) => x > -45_000 && x < -35_000)) {
    map.WaterKindCodes.set(i, 0);
    map.IceThickness.set(i, 100);
  }
  propagateMagic(state, greenwood, 42, 1);
  expect(cells(map, (x) => x > -30_000).every((i) => greenwood.intensity.get(i) === 0)).toBe(true);
  for (const i of cells(map, (x) => x > -45_000 && x < -35_000)) map.IceThickness.set(i, 0);
  propagateMagic(state, greenwood, 42, 1);
  expect(cells(map, (x) => x > -30_000).some((i) => greenwood.intensity.get(i) > 0)).toBe(true);
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
    greenwood.intensity.set(i, 800);
    map.RiverOrders.set(i, 2);
    map.WetlandCover.set(i, 0);
  }
  magicLivingFeedback(state);
  expect(map.Verdure.get(reach[0])).toBeCloseTo(0.8, 6);
  expect(map.WetlandCover.get(reach[0])).toBeGreaterThanOrEqual(0.4);
  expect(map.FloodplainIntensity.get(reach[0])).toBeGreaterThanOrEqual(480);
  const dry = cells(map, (x) => x > 50_000)[0];
  expect(map.Verdure.get(dry)).toBe(0);
  expect(map.WetlandCover.get(dry)).toBe(0);
});

it("collapses an overdrawn spring, seals it, and carries sap in the gut toward the herds", () => {
  const { state, map, greenwood } = scenario();
  const spring = cells(map, (x, y) => Math.abs(x) < 5000 && Math.abs(y) < 5000)[0];
  map.FlowAccumulation.set(spring, 80);
  map.RockResistance.set(spring, 600);
  map.Slope.set(spring, 0.005);
  locateMagicSources(state, greenwood, 42, 0);
  const recharge = greenwood.originSources.spring.get(spring) * map.mesh.area(spring);
  expect(recharge).toBeGreaterThan(0);
  const bedrock = map.BedrockElevation.get(spring);
  drawReservoir(greenwood, "aquifer", spring, recharge * 0.8);
  advanceStocks(state, greenwood, 0);
  expect(greenwood.sealed.get(spring)).toBe(1);
  expect(map.BedrockElevation.get(spring)).toBeLessThan(bedrock);
  locateMagicSources(state, greenwood, 42, 1);
  expect(greenwood.originSources.spring.get(spring)).toBe(0);
  // Herds carry sap to the ground they graze toward.
  const sap = greenwood.stocks["stand/sap"],
    from = cells(map, (x) => x < -80_000)[0],
    neighbour = map.mesh.neighbor(from, 0);
  sap.fill(0);
  sap.set(from, 1000);
  map.Grazers.fill(0);
  map.Grazers.set(from, 500);
  map.Grazers.set(neighbour, 500);
  advanceStocks(state, greenwood, 1);
  expect(sap.get(from)).toBeLessThan(1000);
  expect(sap.get(neighbour)).toBeGreaterThan(0);
});

it("leaves no residue when disabled", () => {
  const { state, map, greenwood } = scenario();
  greenwood.definition.enabled = false;
  greenwood.intensity.fill(800);
  magicLivingFeedback(state);
  expect(Array.from(map.Verdure).every((value) => value === 0)).toBe(true);
});
