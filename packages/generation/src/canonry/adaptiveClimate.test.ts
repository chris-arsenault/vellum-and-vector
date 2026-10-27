import { expect, it } from "vitest";
import { createAdaptiveTopology, rectangle } from "@atlas/domain";
import { adaptivePhysicalMesh } from "./adaptiveMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { oceanConnectivity } from "./ocean";
import { transportOceanHeat } from "./currents";
import { alignedNeighbor } from "./atmosphere";
import { landIce } from "./landIce";
import { iceFlow } from "./iceFlow";
import {
  glacialDeposition,
  glacialErosion,
  glacialMeltwater,
  glacialRunoff,
} from "./glacialEvolution";
import { coastalErosion } from "./coastalEvolution";
import { smoothMetric } from "./metricSmoothing";

const bounds: [number, number, number, number] = [-100_000, -100_000, 100_000, 100_000];
function fixture(refined = true) {
  const topology = createAdaptiveTopology(bounds, {
    maximumSize: 25_000,
    minimumSize: 6250,
    refine: ([x, y, right, top]) =>
      refined && x < 50_000 && right > 0 && y < 50_000 && top > -50_000,
  });
  return createField(adaptivePhysicalMesh(topology, rectangle(bounds)));
}
const integral = (
  map: ReturnType<typeof fixture>,
  values: import("@atlas/domain").NumericalVector
) => values.reduce((sum, value, i) => sum + value * map.mesh.areas[i], 0);

it("chooses initial connected ocean coverage by area rather than refinement density", () => {
  for (const refined of [false, true]) {
    const map = fixture(refined),
      c = physicalContext(42, 0, atlasPhysicalProfile());
    c.Profile.QualityTargets.OceanCoverage.target = 0.5;
    map.Elevation.set(Float64Array.from(map.mesh.x, (x) => (x * 1024) / 1000));
    oceanConnectivity(map, c);
    const wet = map.WaterKindCodes.reduce(
      (area, kind, i) => area + (kind === 1 ? map.mesh.contentAreas[i] : 0),
      0
    );
    expect(wet / 40_000_000_000).toBeGreaterThanOrEqual(0.5);
    expect(wet / 40_000_000_000).toBeLessThan(0.6);
  }
});

it("transports and cools geothermal ocean heat across unequal cells", () => {
  const totals: number[] = [];
  for (const cooling of [0, 50]) {
    const map = fixture();
    map.WaterKindCodes.fill(1);
    map.Geothermal.set(Int32Array.from(map.mesh.x, (x) => (x < -40_000 ? 1000 : 0)));
    const targets = Int32Array.from(map.mesh.x, (_, i) => alignedNeighbor(map, i, -1, 0));
    transportOceanHeat(map, 100_000, cooling, targets);
    expect(map.OceanCurrentHeat.every((v) => v >= 60 && v <= 860)).toBe(true);
    expect(map.OceanCurrentHeat.some((v, i) => map.mesh.x[i] > 0 && v > 60)).toBe(true);
    totals.push(integral(map, Float64Array.from(map.OceanCurrentHeat)));
  }
  expect(totals[1]).toBeLessThan(totals[0]);
});

it("keeps isolated basins separate while smoothing a variable ocean field", () => {
  const map = fixture(),
    mesh = map.mesh;
  const ocean = Uint8Array.from(mesh.x, (x) => Number(Math.abs(x) > 20_000));
  const heat = Float64Array.from(mesh.x, (x, i) => (x < -20_000 ? 500 + mesh.y[i] / 1000 : 0));
  const output = smoothMetric(mesh, heat, 25_000, ocean);
  for (let i = 0; i < mesh.count; i++) if (mesh.x[i] > 20_000) expect(output[i]).toBe(0);
});

it("carries physical ice flux, scour, deposition and retreat history through a warm transition", () => {
  const map = fixture(),
    mesh = map.mesh,
    c = physicalContext(42, 0, atlasPhysicalProfile());
  map.RockResistance.fill(1000);
  map.CrustTypeCodes.fill(2);
  map.Moisture.fill(800);
  map.Snowfall.fill(700);
  for (let i = 0; i < mesh.count; i++) {
    map.Elevation[i] = map.BedrockElevation[i] = (1000 - mesh.x[i] / 1000) * 1024;
    // A cold west and warm east: ice extent follows the mass balance across them.
    map.Temperature[i] = Math.round(260 + mesh.x[i] / 1000 + mesh.y[i] / 7000);
  }
  landIce(map, c);
  const frozen = map.IceThickness.reduce(
    (area, thickness, i) => area + (thickness > 0 ? mesh.areas[i] : 0),
    0
  );
  expect(frozen / 40_000_000_000).toBeGreaterThan(0.1);
  expect(frozen / 40_000_000_000).toBeLessThan(0.9);
  for (let i = 0; i < mesh.count; i++)
    expect(map.IceThickness[i] > 0).toBe(map.IceBalance[i] >= c.Profile.MinimumIceBalance);
  iceFlow(map, c);
  const discharged = map.IceFlux.reduce(
    (sum, flux, i) => sum + (map.IceFlowTargets[i] < 0 ? flux : 0),
    0
  );
  expect(discharged).toBeCloseTo(integral(map, map.IceThickness) / c.Profile.IceTransportYears, -2);
  glacialErosion(map, c);
  glacialDeposition(map, c);
  expect(map.CumulativeGlacialErosion.some((v) => v > 0)).toBe(true);
  expect(map.SedimentDepositedTotal + map.SedimentExportedTotal).toBeCloseTo(
    map.SedimentProducedTotal,
    -2
  );
  map.Temperature.fill(500);
  map.Snowfall.fill(0);
  c.GlaciationStrength = 0;
  for (let pass = 0; pass < 4; pass++) landIce(map, c);
  expect(map.IceThickness.every((v) => v === 0)).toBe(true);
  expect(map.MaximumIceThickness.some((v) => v > 0)).toBe(true);
  glacialMeltwater(map, c);
  map.Runoff.fill(100);
  glacialRunoff(map, c);
  expect(map.Runoff.some((v) => v > 100)).toBe(true);
});

it("preserves an unresolved coastal strip and its material budget across refinement", () => {
  const volumes: number[] = [];
  for (const refined of [false, true]) {
    const map = fixture(refined),
      c = physicalContext(42, 0, atlasPhysicalProfile());
    c.Profile.CoastalActiveWidth = 500;
    map.WaveExposure.fill(1000);
    map.CrustTypeCodes.fill(2);
    for (let i = 0; i < map.mesh.count; i++) {
      map.WaterKindCodes[i] = map.mesh.x[i] < 0 ? 1 : 0;
      map.Elevation[i] = map.BedrockElevation[i] = (map.mesh.x[i] < 0 ? -100 : 100) * 1024;
    }
    coastalErosion(map, c);
    volumes.push(map.SedimentProducedTotal);
    expect(map.SedimentProducedTotal).toBeGreaterThan(0);
    expect(map.SedimentDepositedTotal + map.SedimentExportedTotal).toBeCloseTo(
      map.SedimentProducedTotal,
      -2
    );
  }
  expect(volumes[1] / volumes[0]).toBeGreaterThan(0.95);
  expect(volumes[1] / volumes[0]).toBeLessThan(1.05);
});

it("advances ice onto a frozen deep lake without scouring beneath floating ice", () => {
  const map = fixture(),
    mesh = map.mesh,
    c = physicalContext(42, 0, atlasPhysicalProfile());
  map.Temperature.fill(240);
  map.Snowfall.fill(700);
  map.Moisture.fill(800);
  for (let i = 0; i < mesh.count; i++) {
    map.Elevation[i] = map.BedrockElevation[i] = 300 * 1024;
    if (Math.abs(mesh.x[i]) < 30_000) {
      map.WaterKindCodes[i] = 2;
      map.Elevation[i] = map.BedrockElevation[i] = -900 * 1024;
      map.WaterDepths[i] = 1000 * 1024;
      map.WaterSurfaceElevations[i] = 100 * 1024;
    } else map.IceThickness[i] = 800;
  }
  landIce(map, c);
  iceFlow(map, c);
  expect(map.IceThickness.some((v, i) => map.WaterKindCodes[i] === 2 && v > 0)).toBe(true);
  glacialErosion(map, c);
  for (let i = 0; i < mesh.count; i++)
    if (map.WaterKindCodes[i] === 2) {
      expect(map.GroundedIce[i]).toBe(0);
      expect(map.CumulativeGlacialErosion[i]).toBe(0);
    }
});
