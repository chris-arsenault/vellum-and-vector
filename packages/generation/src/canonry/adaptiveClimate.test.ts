import { expect, it } from "vitest";
import { createAdaptiveTopology, rectangle, type Band } from "@atlas/domain";
import { adaptivePhysicalMesh } from "./adaptiveMesh";
import { createField, type PhysicalField } from "./field";
import { releaseWorking, workingValues } from "./physicalNumerics";
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
const integral = (map: PhysicalField, values: Band) =>
  map.coverage.reduce(values, (sum, value, i) => sum + value * map.mesh.area(i), 0);
/** Number of live (content or halo) cells whose value satisfies the test. */
const countWhere = (map: PhysicalField, band: Band, test: (value: number) => boolean) =>
  map.coverage.reduce(band, (n, value) => n + (test(value) ? 1 : 0), 0);

it("chooses initial connected ocean coverage by area rather than refinement density", () => {
  for (const refined of [false, true]) {
    const map = fixture(refined),
      c = physicalContext(42, 0, atlasPhysicalProfile());
    c.Profile.QualityTargets.OceanCoverage.target = 0.5;
    for (let i = 0; i < map.mesh.count; i++) map.Elevation.set(i, (map.mesh.x(i) * 1024) / 1000);
    oceanConnectivity(map, c);
    const wet = map.coverage.reduce(
      map.WaterKindCodes,
      (area, kind, i) => area + (kind === 1 ? map.mesh.contentArea(i) : 0),
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
    for (let i = 0; i < map.mesh.count; i++)
      map.Geothermal.set(i, map.mesh.x(i) < -40_000 ? 1000 : 0);
    const targets = workingValues(map, "int32", "test:targets", (i) =>
      alignedNeighbor(map, i, -1, 0)
    );
    transportOceanHeat(map, 100_000, cooling, targets);
    expect(countWhere(map, map.OceanCurrentHeat, (v) => v < 60 || v > 860)).toBe(0);
    expect(
      map.coverage.reduce(
        map.OceanCurrentHeat,
        (found, v, i) => (map.mesh.x(i) > 0 && v > 60 ? 1 : found),
        0
      )
    ).toBe(1);
    totals.push(integral(map, map.OceanCurrentHeat));
    releaseWorking(map, targets);
  }
  expect(totals[1]).toBeLessThan(totals[0]);
});

it("keeps isolated basins separate while smoothing a variable ocean field", () => {
  const map = fixture(),
    mesh = map.mesh;
  const ocean = workingValues(map, "uint8", "test:ocean", (i) =>
    Number(Math.abs(mesh.x(i)) > 20_000)
  );
  const heat = workingValues(map, "float64", "test:heat", (i) =>
    mesh.x(i) < -20_000 ? 500 + mesh.y(i) / 1000 : 0
  );
  const output = smoothMetric(map, heat, 25_000, ocean);
  for (let i = 0; i < mesh.count; i++) if (mesh.x(i) > 20_000) expect(output.get(i)).toBe(0);
  releaseWorking(map, ocean, heat, output);
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
    const height = (1000 - mesh.x(i) / 1000) * 1024;
    map.Elevation.set(i, height);
    map.BedrockElevation.set(i, height);
    // A cold west and warm east: ice extent follows the mass balance across them.
    map.Temperature.set(i, Math.round(260 + mesh.x(i) / 1000 + mesh.y(i) / 7000));
  }
  landIce(map, c);
  const frozen = map.coverage.reduce(
    map.IceThickness,
    (area, thickness, i) => area + (thickness > 0 ? mesh.area(i) : 0),
    0
  );
  expect(frozen / 40_000_000_000).toBeGreaterThan(0.1);
  expect(frozen / 40_000_000_000).toBeLessThan(0.9);
  for (let i = 0; i < mesh.count; i++)
    if (mesh.membership(i) !== 0)
      expect(map.IceThickness.get(i) > 0).toBe(
        map.IceBalance.get(i) >= c.Profile.MinimumIceBalance
      );
  iceFlow(map, c);
  const discharged = map.coverage.reduce(
    map.IceFlux,
    (sum, flux, i) => sum + (map.IceFlowTargets.get(i) < 0 ? flux : 0),
    0
  );
  expect(discharged).toBeCloseTo(integral(map, map.IceThickness) / c.Profile.IceTransportYears, -2);
  glacialErosion(map, c);
  glacialDeposition(map, c);
  expect(countWhere(map, map.CumulativeGlacialErosion, (v) => v > 0)).toBeGreaterThan(0);
  expect(map.SedimentDepositedTotal + map.SedimentExportedTotal).toBeCloseTo(
    map.SedimentProducedTotal,
    -2
  );
  map.Temperature.fill(500);
  map.Snowfall.fill(0);
  c.GlaciationStrength = 0;
  for (let pass = 0; pass < 4; pass++) landIce(map, c);
  expect(countWhere(map, map.IceThickness, (v) => v !== 0)).toBe(0);
  expect(countWhere(map, map.MaximumIceThickness, (v) => v > 0)).toBeGreaterThan(0);
  glacialMeltwater(map, c);
  map.Runoff.fill(100);
  glacialRunoff(map, c);
  expect(countWhere(map, map.Runoff, (v) => v > 100)).toBeGreaterThan(0);
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
      map.WaterKindCodes.set(i, map.mesh.x(i) < 0 ? 1 : 0);
      map.Elevation.set(i, (map.mesh.x(i) < 0 ? -100 : 100) * 1024);
      map.BedrockElevation.set(i, map.Elevation.get(i));
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
    map.Elevation.set(i, 300 * 1024);
    map.BedrockElevation.set(i, 300 * 1024);
    if (Math.abs(mesh.x(i)) < 30_000) {
      map.WaterKindCodes.set(i, 2);
      map.Elevation.set(i, -900 * 1024);
      map.BedrockElevation.set(i, -900 * 1024);
      map.WaterDepths.set(i, 1000 * 1024);
      map.WaterSurfaceElevations.set(i, 100 * 1024);
    } else map.IceThickness.set(i, 800);
  }
  landIce(map, c);
  iceFlow(map, c);
  expect(
    map.coverage.reduce(
      map.IceThickness,
      (found, v, i) => (map.WaterKindCodes.get(i) === 2 && v > 0 ? 1 : found),
      0
    )
  ).toBe(1);
  glacialErosion(map, c);
  for (let i = 0; i < mesh.count; i++)
    if (map.WaterKindCodes.get(i) === 2) {
      expect(map.GroundedIce.get(i)).toBe(0);
      expect(map.CumulativeGlacialErosion.get(i)).toBe(0);
    }
});
