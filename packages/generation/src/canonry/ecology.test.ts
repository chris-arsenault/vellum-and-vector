import { expect, it } from "vitest";
import { biomeCode } from "@atlas/domain";
import { createField } from "./field";
import { createMesh } from "./mesh";
import { evolveVegetation } from "./ecologyVegetation";
import { accumulateOrganicMatter, evolveBuriedCarbon } from "./ecologyCarbon";
import { neutralEcology } from "./ecologyEnvironment";
import { ecologyCarbon, ecologyScalars } from "./ecologyState";
import { runoff } from "./climate";
import { surfaceResistance } from "./fluvial";
import { physicalContext } from "./context";
import { atlasPhysicalProfile } from "./atlasProfile";
import { evolveAnimals } from "./ecologyAnimals";

function fixture() {
  const map = createField(createMesh(32, 0));
  map.Elevation.fill(100 * 1024);
  map.BedrockElevation.fill(90 * 1024);
  map.SedimentThickness.fill(10 * 1024);
  map.EcologySediment.fill(10);
  map.DrainageElevations.copyFrom(map.Elevation);
  map.Temperature.fill(450);
  map.Moisture.fill(700);
  map.Rainfall.fill(800);
  map.Slope.fill(0.02);
  map.RockResistance.fill(500);
  map.BroadleafSeed.fill(0.08);
  map.ConiferSeed.fill(0.08);
  return map;
}
const forcing = (values: Partial<typeof neutralEcology>) => () => ({
  ...neutralEcology,
  ...values,
});
const total = (map: ReturnType<typeof fixture>, i = 0) =>
  ecologyCarbon.reduce((sum, name) => sum + map[name].get(i), 0);

it("grows pioneer grass before forest and supports trophic groups without species", () => {
  const young = fixture(),
    mature = fixture();
  evolveVegetation(young, 5);
  evolveVegetation(mature, 1000);
  expect(young.GrassCover.get(0)).toBeGreaterThan(young.TreeCover.get(0));
  expect(mature.BiomeCodes.get(0)).toBe(biomeCode("Temperate forest"));
  expect(mature.TreeCover.get(0)).toBeGreaterThan(0.5);
  expect(mature.Herbivores.get(0)).toBeGreaterThan(0);
  expect(mature.Predators.get(0)).toBeGreaterThan(0);
});

it("distinguishes dry grassland/desert, boreal forest, rainforest and ice", () => {
  const cases = [
    [450, 200, 300, "Grassland"],
    [500, 30, 30, "Desert"],
    [350, 700, 800, "Boreal forest"],
    // Rainforest needs tropical rain, about twice its evaporative demand of 1.5 m.
    [560, 950, 2000, "Rainforest"],
    [100, 700, 800, "Ice"],
  ] as const;
  for (const [temperature, moisture, rain, name] of cases) {
    const map = fixture();
    map.Temperature.fill(temperature);
    map.Moisture.fill(moisture);
    map.Rainfall.fill(rain);
    if (name === "Ice") map.IceThickness.fill(50);
    evolveVegetation(map, 1000);
    expect(map.BiomeCodes.get(0)).toBe(biomeCode(name));
  }
});

it("retains forest history through swamp, aquatic accumulation, burial and oil formation", () => {
  const map = fixture();
  evolveVegetation(map, 1000);
  expect(map.BiomeCodes.get(0)).toBe(biomeCode("Temperate forest"));
  map.Slope.fill(0.001);
  map.FloodplainIntensity.fill(900);
  map.Moisture.fill(900);
  evolveVegetation(map, 10_000);
  accumulateOrganicMatter(map, 10_000);
  expect(map.BiomeCodes.get(0)).toBe(biomeCode("Swamp"));
  expect(map.PeatCarbon.get(0)).toBeGreaterThan(10);
  expect(map.AquaticCarbon.get(0)).toBeGreaterThan(1);
  expect(map.AquaticFauna.get(0)).toBe(0); // No aquatic population or connected water source.
  map.SedimentThickness.fill(4010 * 1024);
  const before = total(map);
  evolveBuriedCarbon(map, 10_000_000);
  expect(map.OrganicBurialDepth.get(0)).toBeCloseTo(2000);
  expect(map.CoalCarbon.get(0)).toBeGreaterThan(1);
  expect(map.OilCarbon.get(0)).toBeGreaterThan(1);
  expect(map.GasCarbon.get(0)).toBeGreaterThan(1);
  expect(total(map)).toBeCloseTo(before, 8);
});

it("does not generate hydrocarbons from an old unburied swamp or a young cold source", () => {
  const swamp = fixture();
  swamp.PeatCarbon.fill(100);
  swamp.AquaticCarbon.fill(100);
  evolveBuriedCarbon(swamp, 100_000_000);
  expect(swamp.OilCarbon.get(0)).toBe(0);
  expect(swamp.CoalCarbon.get(0)).toBe(0);
  swamp.SedimentThickness.fill(4010 * 1024);
  evolveBuriedCarbon(swamp, 1000);
  expect(swamp.OilCarbon.get(0)).toBeLessThan(0.1);
  const cold = fixture();
  cold.AquaticCarbon.fill(100);
  cold.SedimentThickness.fill(110 * 1024);
  evolveBuriedCarbon(cold, 100_000_000);
  expect(cold.OilCarbon.get(0)).toBe(0);
});

it("makes aquatic source material more oil prone and terrestrial source material coal/gas prone", () => {
  const plant = fixture(),
    aquatic = fixture();
  plant.PeatCarbon.fill(100);
  aquatic.AquaticCarbon.fill(100);
  for (const map of [plant, aquatic]) {
    map.SedimentThickness.fill(6010 * 1024);
    evolveBuriedCarbon(map, 10_000_000);
    expect(total(map)).toBeCloseTo(100, 9);
  }
  expect(aquatic.OilCarbon.get(0)).toBeGreaterThan(plant.OilCarbon.get(0) * 5);
  expect(plant.CoalCarbon.get(0)).toBeGreaterThan(aquatic.CoalCarbon.get(0));
});

it("oxidizes exposed peat and preserves waterlogged organic matter", () => {
  const dry = fixture(),
    wet = fixture();
  dry.PeatCarbon.fill(100);
  wet.PeatCarbon.fill(100);
  wet.WaterKindCodes.fill(2);
  wet.WaterDepths.fill(10 * 1024);
  accumulateOrganicMatter(dry, 100);
  accumulateOrganicMatter(wet, 100);
  expect(wet.PeatCarbon.get(0)).toBeGreaterThan(dry.PeatCarbon.get(0) * 10);
});

it("responds to growth, fire and preservation magic with real ecological changes", () => {
  const plain = fixture(),
    growth = fixture(),
    fire = fixture();
  plain.Moisture.fill(400);
  growth.Moisture.fill(400);
  for (const map of [plain, growth, fire]) map.TreeCover.fill(0.8);
  evolveVegetation(plain, 500);
  evolveVegetation(growth, 500, forcing({ growth: 1 }));
  evolveVegetation(fire, 500, forcing({ fire: 0.95 }));
  expect(growth.Productivity.get(0)).toBeGreaterThan(plain.Productivity.get(0));
  expect(fire.TreeCover.get(0)).toBeLessThan(plain.TreeCover.get(0));
  expect(fire.FireActivity.get(0)).toBeGreaterThan(0.9);
  const decay = fixture(),
    preserve = fixture();
  decay.PeatCarbon.fill(100);
  preserve.PeatCarbon.fill(100);
  accumulateOrganicMatter(decay, 100);
  accumulateOrganicMatter(preserve, 100, forcing({ preservation: 2 }));
  expect(preserve.PeatCarbon.get(0)).toBeGreaterThan(decay.PeatCarbon.get(0));
});

it("grazers suppress cover, predators suppress grazers and aquatic life requires production", () => {
  const grazed = fixture(),
    control = fixture();
  grazed.Herbivores.fill(0.5);
  evolveVegetation(grazed, 100);
  evolveVegetation(control, 100);
  expect(grazed.TreeCover.get(0)).toBeLessThan(control.TreeCover.get(0));
  const hunted = fixture(),
    safe = fixture();
  hunted.Predators.fill(0.1);
  evolveVegetation(hunted, 100);
  evolveVegetation(safe, 100);
  expect(hunted.Herbivores.get(0)).toBeLessThan(safe.Herbivores.get(0));
  expect(safe.AquaticFauna.get(0)).toBe(0);
});

it("exhausts tiny grass stocks without negative cover from biomass conversion", () => {
  const map = fixture();
  map.GrassCover.fill(4.3e-15);
  map.Grazers.fill(0.01);
  evolveAnimals(map, 1, forcing({}));
  expect(Array.from(map.GrassCover).every((value) => value === 0)).toBe(true);
  expect(Array.from(map.SoilCarbon).every((value) => Number.isFinite(value) && value >= 0)).toBe(
    true
  );
});

it("roots resist erosion and vegetation reduces runoff without changing rainfall", () => {
  const bare = fixture(),
    forest = fixture();
  forest.TreeCover.fill(0.8);
  const c = physicalContext(42, 0, atlasPhysicalProfile());
  runoff(bare, c);
  runoff(forest, c);
  expect(forest.Runoff.get(0)).toBeLessThan(bare.Runoff.get(0));
  expect(surfaceResistance(forest, 0)).toBeGreaterThan(surfaceResistance(bare, 0));
  expect(Array.from(forest.Rainfall)).toEqual(Array.from(bare.Rainfall));
});

it("exhumes buried carbon and cracks overheated oil into gas without creating carbon", () => {
  const map = fixture();
  map.OilCarbon.fill(100);
  map.OrganicBurialDepth.fill(3000);
  map.Temperature.fill(1200);
  evolveBuriedCarbon(map, 10_000_000);
  expect(map.OilCarbon.get(0)).toBeLessThan(100);
  expect(map.GasCarbon.get(0)).toBeGreaterThan(0);
  expect(total(map)).toBeCloseTo(100, 9);
  map.EcologySediment.fill(5000);
  map.SedimentThickness.fill(0);
  evolveBuriedCarbon(map, 1000);
  expect(total(map)).toBeLessThan(100);
  expect(map.OrganicBurialDepth.get(0)).toBe(0);
});

it("is deterministic and finite over very short and geological durations", () => {
  const a = fixture(),
    b = fixture();
  for (const years of [0.01, 10, 1000, 100_000_000])
    for (const map of [a, b]) {
      evolveVegetation(map, years);
      accumulateOrganicMatter(map, years);
      evolveBuriedCarbon(map, years);
    }
  for (const name of ecologyScalars) {
    expect(Array.from(a[name])).toEqual(Array.from(b[name]));
    expect(Array.from(a[name]).every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
  }
});

it("bounds cover under strong growth and leaves zero-duration biology unchanged", () => {
  const map = fixture();
  evolveVegetation(map, 1000, forcing({ growth: 5, productivity: 5 }));
  for (const channel of [map.TreeCover, map.GrassCover, map.WetlandCover])
    expect(Array.from(channel).every((value) => value >= 0 && value <= 1)).toBe(true);
  const before = Array.from(map.TreeCover);
  evolveVegetation(map, 0, forcing({ fire: 1 }));
  expect(Array.from(map.TreeCover)).toEqual(before);
});
