import { expect, it } from "vitest";
import { macroFixture } from "./macroFixtures";
import { composeBiologicalRegions } from "./macroCover";
import { composeHabitats, reconcileEcologicalSupport } from "./macroHabitat";
import { nearestTriangle } from "./mesh";
import { canopy } from "./ecologyGroups";

it("moves inherited altered cohorts and traits together without maturing young stands or changing buried resources", () => {
  const work = macroFixture().physical!,
    map = work.map,
    mesh = map.mesh,
    hole = nearestTriangle(mesh, -35_000, 0);
  for (let i = 0; i < mesh.count; i++) {
    map.AlteredCover[i] = 0.6;
    map.AlteredSaplings[i] = 0.1;
    map.TreeCover[i] = 0.635;
    map.AlteredSeed[i] = 0.2;
    map.CanopyAge[i] = mesh.x[i] < 0 ? 20 : 200;
    map.ColdAdaptation[i] = 18;
    map.DroughtAdaptation[i] = 0.4;
    map.EcologicalAlteration[i] = 0.7;
    map.CoalCarbon[i] = 12;
    map.OrganicMaturity[i] = 100;
    map.MigrationFlux[i] = 0.125;
  }
  map.AlteredCover[hole] =
    map.AlteredSaplings[hole] =
    map.TreeCover[hole] =
    map.AlteredSeed[hole] =
    map.ColdAdaptation[hole] =
      0;
  const ageMass = () =>
      map.CanopyAge.reduce((sum, value, i) => sum + value * canopy(map, i) * mesh.areas[i], 0),
    before = ageMass();
  composeBiologicalRegions(work);
  expect(map.AlteredCover[hole]).toBeGreaterThan(0.2);
  expect(map.ColdAdaptation[hole]).toBeGreaterThan(0);
  expect(map.CanopyAge[hole]).toBeCloseTo(20, 6);
  expect(ageMass() / before).toBeCloseTo(1, 9);
  expect(map.CoalCarbon.every((v) => v === 12)).toBe(true);
  expect(map.OrganicMaturity.every((v) => v === 100)).toBe(true);
  expect(map.MigrationFlux.every((v) => v === 0.125)).toBe(true);
});

it("keeps terrestrial and aquatic populations behind their barriers and preserves represented biomass", () => {
  const work = macroFixture().physical!,
    map = work.map,
    mesh = map.mesh;
  map.Productivity.fill(1);
  map.GrassCover.fill(0.8);
  map.AquaticProductivity.fill(0.1);
  for (let i = 0; i < mesh.count; i++) {
    if (Math.abs(mesh.x[i]) < 15_000) {
      map.WaterKindCodes[i] = 1;
      map.WaterDepths[i] = 20 * 1024;
    } else if (mesh.x[i] < -15_000) map.Grazers[i] = 0.01;
    if (mesh.y[i] > 20_000 && map.WaterKindCodes[i]) map.AquaticFauna[i] = 0.02;
    if (Math.abs(mesh.y[i]) < 15_000) map.IceThickness[i] = 400;
  }
  const mass = (values: Float64Array) =>
      values.reduce((sum, value, i) => sum + value * mesh.areas[i], 0),
    grazers = mass(map.Grazers),
    fish = mass(map.AquaticFauna);
  composeHabitats(work);
  expect(map.Grazers.every((v, i) => mesh.x[i] < 0 || v === 0)).toBe(true);
  expect(map.AquaticFauna.every((v, i) => mesh.y[i] > 0 || v === 0)).toBe(true);
  expect(mass(map.Grazers) / grazers).toBeCloseTo(1, 10);
  expect(mass(map.AquaticFauna) / fish).toBeCloseTo(1, 10);
  expect(map.Herbivores.every((v, i) => v === map.Grazers[i] + map.Browsers[i])).toBe(true);
});

it("makes habitat loss from newly unsupported land explicit in detrital carbon without inventing growth", () => {
  const work = macroFixture().physical!,
    map = work.map;
  map.BroadleafCover[0] = 0.5;
  map.Grazers[0] = 0.1;
  map.WaterKindCodes[0] = 1;
  map.WaterDepths[0] = 20 * 1024;
  reconcileEcologicalSupport(work);
  expect(map.BroadleafCover[0]).toBe(0);
  expect(map.SoilCarbon[0]).toBeCloseTo(5.1);
  expect(map.Grazers[0]).toBe(0);
  expect(map.CompletedEpochCount).toBe(0);
});
