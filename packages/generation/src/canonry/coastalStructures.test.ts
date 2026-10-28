import { expect, it } from "vitest";
import { createField, type PhysicalField } from "./field";
import { createWorldMesh } from "./worldMesh";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { tectonicSites } from "./tectonicState";
import { subductionArcs } from "./volcanicArcs";
import { continentalMarginEvolution, marineSedimentation } from "./continentalMargins";
import { oceanConnectivity } from "./ocean";
import { landmasses } from "./geography";
import { units } from "./math";
import { tectonicArcMeltShare } from "./tectonicControls";

function shelf() {
  const map = createField(createWorldMesh([0, 0, 800_000, 600_000], 4096, 0));
  const c = physicalContext(73, 0, atlasPhysicalProfile());
  map.SeaLevelInitialized = true;
  map.MarginCodes.fill(1);
  for (let i = 0; i < map.mesh.count; i++) {
    const x = map.mesh.x(i),
      y = map.mesh.y(i);
    const island = Math.hypot(Math.abs(x) - 180_000, y) < 140_000;
    const saddle = Math.abs(x) < 180_000 && Math.abs(y) < 45_000;
    map.CrustThickness.set(i, units(4000));
    map.BedrockElevation.set(i, units(island ? 200 : saddle ? -30 : -400));
    map.Elevation.set(i, map.BedrockElevation.get(i));
  }
  return { map, c };
}

function landmassCount(map: PhysicalField) {
  const ids = new Set<number>();
  for (let i = 0; i < map.mesh.count; i++)
    if (map.mesh.membership(i) !== 0) ids.add(map.LandmassIds.get(i));
  return ids.size;
}

it("preserves shelf highs and a shallow saddle whose exposure joins two landmasses", () => {
  const { map, c } = shelf();
  oceanConnectivity(map, c);
  landmasses(map, c);
  expect(landmassCount(map)).toBe(3);
  const bedrock = map.coverage.copyBand(map.BedrockElevation),
    crust = map.coverage.copyBand(map.CrustThickness);
  continentalMarginEvolution(map);
  expect(Array.from(map.BedrockElevation)).toEqual(Array.from(bedrock));
  expect(Array.from(map.CrustThickness)).toEqual(Array.from(crust));
  c.SeaLevelOffset = -50;
  oceanConnectivity(map, c);
  landmasses(map, c);
  expect(landmassCount(map)).toBe(2);
});

it("fills marine accommodation from exported sediment and preserves the remaining budget", () => {
  const { map, c } = shelf();
  oceanConnectivity(map, c);
  continentalMarginEvolution(map);
  const budget = 1e11;
  map.SedimentExportedTotal = budget;
  marineSedimentation(map, c);
  const deposited = map.coverage.reduce(
    map.SedimentThickness,
    (sum, value, i) => sum + (value * map.mesh.area(i)) / 1024,
    0
  );
  expect(deposited).toBeGreaterThan(0);
  expect((deposited + map.SedimentExportedTotal) / budget).toBeCloseTo(1, 10);
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes.get(i) === 1)
      expect(map.Elevation.get(i)).toBeLessThanOrEqual(map.EffectiveSeaLevel);
});

it("supplies an emerging volcanic front on the overriding side without a plume", () => {
  const { map, c } = shelf();
  tectonicSites(map, c);
  const state = map.tectonics!;
  state.sites = state.sites
    .slice(0, 2)
    .map((site, i) => ({ ...site, x: i ? 150_000 : -150_000, y: 0, plate: i + 1 }));
  map.Elevation.fill(units(-200));
  map.BedrockElevation.copyFrom(map.Elevation);
  let supplied = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    map.CrustContinentalFraction.set(i, map.mesh.x(i) < 0 ? 1000 : 0);
    if (Math.abs(map.mesh.x(i)) > 15_000 || Math.abs(map.mesh.y(i)) > 100_000) continue;
    map.TectonicBoundaryPairIds.set(i, (1 << 16) | 2);
    map.OceanicSubduction.set(i, units(10_000));
    supplied += map.OceanicSubduction.get(i) * map.mesh.area(i);
  }
  subductionArcs(map, c);
  const volume = map.coverage.reduce(
    map.VolcanicConstructionHistory,
    (sum, value, i) => sum + value * map.mesh.area(i),
    0
  );
  const moment = map.coverage.reduce(
    map.VolcanicConstructionHistory,
    (sum, value, i) => sum + value * map.mesh.area(i) * map.mesh.x(i),
    0
  );
  expect(volume / supplied).toBeCloseTo(tectonicArcMeltShare, 10);
  expect(moment / volume).toBeLessThan(-100_000);
  expect(
    map.coverage.reduce(map.Elevation, (count, value) => count + (value > 0 ? 1 : 0), 0)
  ).toBeGreaterThan(0);
  const history = map.coverage.copyBand(map.VolcanicConstructionHistory);
  subductionArcs(map, c);
  expect(Array.from(map.VolcanicConstructionHistory)).toEqual(Array.from(history));
  expect(map.events).toHaveLength(0);
});
