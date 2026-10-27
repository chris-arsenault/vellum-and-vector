import { expect, it } from "vitest";
import { createAdaptiveTopology, rectangle } from "@atlas/domain";
import { adaptivePhysicalMesh } from "./adaptiveMesh";
import { createField } from "./field";
import { updateTreeCover } from "./ecologyGrowth";
import { dispersePlants } from "./ecologyEstablishment";
import { evolveVegetation } from "./ecologyVegetation";
import { neutralEcology } from "./ecologyEnvironment";
import { migrateAnimals } from "./ecologyMovement";
import { disturbEcology } from "./ecologyDisturbance";
import { applyToxicity } from "./ecologyMagic";
import { physicalContext } from "./context";
import { atlasPhysicalProfile } from "./atlasProfile";
import { precipitation } from "./climate";

function corridor() {
  const bounds: [number, number, number, number] = [0, 0, 20_000, 4000];
  const topology = createAdaptiveTopology(bounds, { maximumSize: 1000, minimumSize: 1000 });
  const map = createField(adaptivePhysicalMesh(topology, rectangle(bounds)));
  map.EcologyInitialized = true;
  map.Elevation.fill(100 * 1024);
  map.BedrockElevation.fill(90 * 1024);
  map.SedimentThickness.fill(10 * 1024);
  map.EcologySediment.fill(10);
  map.DrainageElevations.set(map.Elevation);
  map.Temperature.fill(450);
  map.Moisture.fill(850);
  map.Rainfall.fill(950);
  map.SoilDepth.fill(0.5);
  map.SoilWater.fill(0.1);
  map.MineralNutrients.fill(0.15);
  map.Slope.fill(0.001);
  return map;
}
const xAt = (map: ReturnType<typeof corridor>, i: number) => map.mesh.x[i] + map.mesh.origin[0];
const force = (f: Partial<typeof neutralEcology>) => () => ({ ...neutralEcology, ...f });
const mass = (map: ReturnType<typeof corridor>, values: import("@atlas/domain").NumericalVector) =>
  values.reduce((sum, v, i) => sum + v * map.mesh.areas[i], 0);
function source(map: ReturnType<typeof corridor>) {
  for (let i = 0; i < map.mesh.count; i++)
    if (xAt(map, i) < 2000) {
      map.BroadleafCover[i] = 0.7;
      map.BroadleafSeed[i] = 0.2;
      updateTreeCover(map, i);
    }
}
function barrier(map: ReturnType<typeof corridor>) {
  for (let i = 0; i < map.mesh.count; i++)
    if (xAt(map, i) > 9500 && xAt(map, i) < 10_500) {
      map.WaterKindCodes[i] = 2;
      map.WaterDepths[i] = 5 * 1024;
    }
}

it("requires a propagule source and respects physical travel time and water barriers", () => {
  const empty = corridor();
  evolveVegetation(empty, 1000);
  expect(empty.TreeCover.every((v) => v === 0)).toBe(true);
  const open = corridor();
  source(open);
  const arrival = dispersePlants(open, 1000, force({})).find((a) => a.group.id === "broadleaf")!;
  const far = Array.from(open.mesh.x.keys()).find((i) => xAt(open, i) > 18_000)!;
  expect(arrival.front.time[far]).toBeGreaterThan((18_000 - 2000) / 180);
  const slower = dispersePlants(open, 1000, force({ migration: 0.5 })).find(
    (a) => a.group.id === "broadleaf"
  )!;
  expect(slower.front.time[far]).toBeGreaterThan(arrival.front.time[far] * 1.5);
  const blocked = corridor();
  source(blocked);
  barrier(blocked);
  const stopped = dispersePlants(blocked, 1000, force({})).find((a) => a.group.id === "broadleaf")!;
  expect(stopped.front.time[far]).toBe(Infinity);
});

it("establishes young trees before mature canopy and limits development by nutrients", () => {
  const young = corridor(),
    mature = corridor(),
    depleted = corridor();
  for (const map of [young, mature, depleted]) map.BroadleafSeed.fill(0.2);
  depleted.MineralNutrients.fill(0);
  evolveVegetation(young, 10, force({ recovery: 0 }));
  evolveVegetation(mature, 1000, force({ recovery: 0 }));
  evolveVegetation(depleted, 1000, force({ recovery: 0 }));
  expect(young.BroadleafSaplings[0]).toBeGreaterThan(young.BroadleafCover[0]);
  expect(mature.BroadleafCover[0]).toBeGreaterThan(0.4);
  expect(depleted.BroadleafCover[0]).toBe(0);
  expect(mature.CanopyAge[0]).toBeGreaterThan(young.CanopyAge[0]);
  expect(mature.CanopyAge[0]).toBeLessThan(250); // Turnover replaces trees within a long epoch.
});

it("moves existing animal biomass into reachable refuge without creating biomass", () => {
  const map = corridor(),
    capacity = new Float64Array(map.mesh.count);
  for (let i = 0; i < capacity.length; i++) {
    if (xAt(map, i) < 2000) map.Grazers[i] = 0.1;
    if (xAt(map, i) > 16_000) capacity[i] = 0.05;
  }
  const before = mass(map, map.Grazers);
  migrateAnimals(map, map.Grazers, capacity, 100, 12_000);
  expect(mass(map, map.Grazers)).toBeCloseTo(before, 5);
  expect(map.MigrationFlux.some((value) => value > 0)).toBe(true);
  expect(Array.from(map.Grazers).some((v, i) => v > 0 && xAt(map, i) > 16_000)).toBe(true);
  const isolated = corridor();
  barrier(isolated);
  isolated.Grazers[0] = 0.1;
  const blockedMass = mass(isolated, isolated.Grazers);
  migrateAnimals(isolated, isolated.Grazers, capacity, 100, 12_000);
  expect(mass(isolated, isolated.Grazers)).toBeCloseTo(blockedMass, 5);
  expect(isolated.MigrationFlux.every((v) => v === 0)).toBe(true);
});

it("spreads fire through connected dry fuel and stops it at a water barrier", () => {
  const open = corridor(),
    blocked = corridor();
  for (const map of [open, blocked]) {
    map.BroadleafCover.fill(0.7);
    map.TreeCover.fill(0.7);
    map.Moisture.fill(100);
    map.Rainfall.fill(100);
    map.SoilWater.fill(0);
  }
  barrier(blocked);
  for (const map of [open, blocked])
    disturbEcology(
      map,
      100,
      (i) => ({ ...neutralEcology, fireRegime: 0, fire: xAt(map, i) < 1000 ? 0.9 : 0 }),
      42
    );
  const far = Array.from(open.mesh.x.keys()).find((i) => xAt(open, i) > 16_000)!;
  expect(open.BroadleafCover[far]).toBeLessThan(0.7);
  expect(blocked.BroadleafCover[far]).toBe(0.7);
});

it("lets a strong headwind hold back fire that a gentle wind allows to spread", () => {
  const gentle = corridor(),
    strong = corridor();
  for (const [map, speed] of [
    [gentle, 3.5],
    [strong, 14],
  ] as const) {
    map.BroadleafCover.fill(0.7);
    map.TreeCover.fill(0.7);
    map.Moisture.fill(100);
    map.Rainfall.fill(100);
    map.SoilWater.fill(0);
    // Wind blows toward the fire's origin, against its spread.
    map.WindX.fill(-1000);
    map.WindSpeed.fill(speed);
    disturbEcology(
      map,
      100,
      (i) => ({ ...neutralEcology, fireRegime: 0, fire: xAt(map, i) < 1000 ? 0.9 : 0 }),
      42
    );
  }
  const far = Array.from(gentle.mesh.x.keys()).find((i) => xAt(gentle, i) > 16_000)!;
  expect(gentle.BroadleafCover[far]).toBeLessThan(0.7);
  expect(strong.BroadleafCover[far]).toBe(0.7);
});

it("raises habitat toxicity at once and bounds it, then lets it recover over the epoch", () => {
  const map = corridor();
  source(map);
  applyToxicity(map, 0, force({ toxicity: 2 }));
  expect(map.EcologicalToxicity.every((v) => v <= 1)).toBe(true);
  expect(map.EcologicalToxicity.some((v) => v > 0)).toBe(true);
  applyToxicity(map, 500, force({ toxicity: 0, recovery: 1 }));
  expect(map.EcologicalToxicity.every((v) => v < 0.5)).toBe(true);
});

it("leaves glacial soil and seed losses that delay recovery after the ice retreats", () => {
  const map = corridor();
  map.BroadleafCover.fill(0.6);
  map.BroadleafSeed.fill(0.2);
  for (let i = 0; i < map.mesh.count; i++) if (xAt(map, i) > 10_000) map.IceThickness[i] = 50;
  evolveVegetation(map, 200);
  const damaged = Array.from(map.mesh.x.keys()).find((i) => xAt(map, i) > 18_000)!;
  expect(map.TreeCover[damaged]).toBeLessThan(0.001);
  expect(map.SoilDepth[damaged]).toBeLessThan(map.SoilDepth[0]);
  map.IceThickness.fill(0);
  evolveVegetation(map, 20);
  expect(map.TreeCover[damaged]).toBeLessThan(0.05);
  expect(map.EcologicalDamage[damaged]).toBeGreaterThan(0.5);
});

it("produces different ecological states from a shared warm, dry/fire and cold history", () => {
  const wet = corridor();
  wet.BroadleafSeed.fill(0.2);
  wet.GrassSeed.fill(0.2);
  evolveVegetation(wet, 1000, force({ fireRegime: 0.2, seasonality: 0.1 }));
  const dry = structuredClone(wet),
    cold = structuredClone(wet);
  dry.Rainfall.fill(120);
  dry.Moisture.fill(180);
  dry.Temperature.fill(560);
  evolveVegetation(dry, 1000, force({ fireRegime: 4, seasonality: 0.9 }));
  cold.IceThickness.fill(50);
  evolveVegetation(cold, 1000);
  expect(mass(wet, wet.TreeCover)).toBeGreaterThan(mass(dry, dry.TreeCover));
  expect(mass(wet, wet.TreeCover)).toBeGreaterThan(mass(cold, cold.TreeCover));
  expect(new Set([wet.BiomeCodes[0], dry.BiomeCodes[0], cold.BiomeCodes[0]]).size).toBe(3);
});

it("scales total physical precipitation with ecological epoch rainfall", () => {
  const map = corridor(),
    c = physicalContext(42, 0, atlasPhysicalProfile());
  precipitation(map, c);
  const normal = map.Rainfall[0] + map.Snowfall[0];
  c.RainfallMultiplier = 0.25;
  precipitation(map, c);
  expect(Math.abs(map.Rainfall[0] + map.Snowfall[0] - normal / 4)).toBeLessThanOrEqual(1);
  c.RainfallMultiplier = 0;
  precipitation(map, c);
  expect(map.Rainfall.every((v) => v === 0)).toBe(true);
});
