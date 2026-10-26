import { expect, it } from "vitest";
import { createField } from "./field";
import { createWorldMesh } from "./worldMesh";
import { atlasPhysicalProfile, atlasEpoch } from "./atlasProfile";
import { physicalContext } from "./context";
import { tectonicSites, plateOf, indexTectonicBonds } from "./tectonicState";
import { tectonicProvinces } from "./provinces";
import { plateAdvection } from "./advection";
import { crustalSupport, lithosphericFlexure } from "./support";
import { oceanConnectivity } from "./ocean";
import { landmasses } from "./geography";
import { units } from "./math";
import { orogenicConstruction } from "./orogeny";

function continent(extension: number) {
  const map = createField(
    createWorldMesh([0, 0, 2e6, 1e6], 4096, 0, undefined, undefined, undefined, true)
  );
  const p = atlasPhysicalProfile({}, { ContinentalWarpStrength: 0 });
  const epoch = atlasEpoch({
    id: "breakup",
    tectonicDurationMyr: 25,
    tectonics: 1,
    hydrology: 1,
    ice: 0,
    coasts: 1,
    temperature: 15,
    seaLevel: 0,
  });
  const c = physicalContext(73, 0, p, epoch, 0, 1);
  tectonicSites(map, c);
  const state = map.tectonics!;
  state.sites = state.sites.slice(0, 2).map((site, i) => ({
    ...site,
    x: i ? 200_000 : -200_000,
    y: 0,
    plate: 1,
    assembly: 1,
    driveX: (i ? 1 : -1) * extension,
    driveY: 0,
    motionX: 0,
    motionY: 0,
    mass: 1,
    area: 1e12,
    compliance: 0,
  }));
  state.plates = [plateOf(map, state.sites, 1)];
  state.nextPlateId = 2;
  state.bonds = [
    { a: 0, b: 1, extension: 0, shortening: 0, strength: 1, active: true, broken: false },
  ];
  indexTectonicBonds(state);
  tectonicProvinces(map, c);
  for (let i = 0; i < map.mesh.count; i++) {
    const land = Math.abs(map.mesh.x[i]) < 650_000 && Math.abs(map.mesh.y[i]) < 350_000;
    map.CrustThickness[i] = units(land ? 4000 : 1000);
    map.CrustContinentalFraction[i] = land ? 1000 : 0;
    map.BedrockElevation[i] = units(land ? 300 : -1600);
    map.Elevation[i] = map.BedrockElevation[i];
  }
  crustalSupport(map, c, false);
  lithosphericFlexure(map, c);
  map.SeaLevelInitialized = true;
  oceanConnectivity(map, c);
  return { map, c };
}

it("opens a marine basin through a formerly connected continent using the shared motion", () => {
  const { map, c } = continent(0.8);
  landmasses(map, c);
  expect(new Set(map.LandmassIds).size).toBe(2); // Ocean plus one connected continent.
  plateAdvection(map, c);
  crustalSupport(map, c, false);
  lithosphericFlexure(map, c);
  oceanConnectivity(map, c);
  landmasses(map, c);
  expect(map.tectonics!.splits).toBe(1);
  expect(new Set(map.LandmassIds).size).toBeGreaterThan(2);
  const center = map.mesh.x.findIndex(
    (x, i) => Math.abs(x) < 20_000 && Math.abs(map.mesh.y[i]) < 20_000
  );
  expect(map.WaterKindCodes[center]).toBe(1);
  expect(map.CrustContinentalFraction[center]).toBeLessThan(100);
  expect(map.crustBudget.oceanCreated).toBeGreaterThan(0);
});

it("keeps the starting continent connected without differential driving", () => {
  const { map, c } = continent(0);
  plateAdvection(map, c);
  crustalSupport(map, c, false);
  lithosphericFlexure(map, c);
  oceanConnectivity(map, c);
  landmasses(map, c);
  expect(map.tectonics!.splits).toBe(0);
  expect(new Set(map.LandmassIds).size).toBe(2);
});

it("narrows and closes a young basin when its fragments converge again", () => {
  const { map, c } = continent(0.8);
  const surface = () => {
    orogenicConstruction(map, c);
    crustalSupport(map, c, false);
    lithosphericFlexure(map, c);
    oceanConnectivity(map, c);
  };
  plateAdvection(map, c);
  surface();
  const oceanWidth = () =>
    map.WaterKindCodes.reduce(
      (sum, value, i) =>
        sum +
        (value === 1 && Math.abs(map.mesh.y[i]) < 50_000 && Math.abs(map.mesh.x[i]) < 500_000
          ? map.mesh.areas[i]
          : 0),
      0
    );
  const opened = oceanWidth();
  expect(opened).toBeGreaterThan(0);
  for (const site of map.tectonics!.sites) site.driveX *= -1;
  c.TectonicDurationMyr = 60;
  plateAdvection(map, c);
  expect(map.CrustRootReserve.some((value) => value > 0)).toBe(true);
  surface();
  expect(oceanWidth()).toBeLessThan(opened * 0.2);
  expect(map.OrogenicConstruction.some((value) => value > 0)).toBe(true);
});
