import { expect, it } from "vitest";
import { createWorldMesh } from "./worldMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { coastalErosion, externalCoastalForcing } from "./coastalEvolution";
import { coastalDetail } from "./coastalDetail";
import { smoothMetric } from "./metricSmoothing";
import { transportOceanHeat } from "./currents";
import { alignedNeighbor } from "./atmosphere";
import { createAdaptiveWorldMesh } from "./adaptiveMesh";

function coast(samples: number) {
  const size = 100_000 / Math.sqrt(samples);
  const map = createField(
    createAdaptiveWorldMesh([0, 0, 100_000, 100_000], { maximumSize: size, minimumSize: size }, 0)
  );
  for (let i = 0; i < map.mesh.count; i++) {
    map.WaterKindCodes[i] = map.mesh.x[i] < 0 ? 1 : 0;
    map.WaveExposure[i] = 1000;
    map.CrustTypeCodes[i] = 2;
    map.BedrockElevation[i] = map.Elevation[i] = (map.mesh.x[i] < 0 ? -100 : 100) * 1024;
  }
  return map;
}

it("keeps erosion volume and shore width physical when sampling doubles", () => {
  const volumes: number[] = [];
  for (const samples of [1024, 4096]) {
    const map = coast(samples),
      profile = atlasPhysicalProfile();
    coastalErosion(map, physicalContext(157, 0, profile));
    volumes.push(map.SedimentProducedTotal);
    const width = Math.max(...map.mesh.x.filter((_, i) => map.CumulativeCoastalErosion[i] > 0));
    expect(width).toBeGreaterThan(profile.CoastalActiveWidth * 0.8);
    expect(width).toBeLessThan(profile.CoastalActiveWidth + map.mesh.spacing);
    expect(map.SedimentDepositedTotal + map.SedimentExportedTotal).toBeCloseTo(
      map.SedimentProducedTotal,
      -2
    );
    expect(map.SedimentDepositedTotal).toBeGreaterThan(0);
  }
  expect(volumes[1] / volumes[0]).toBeGreaterThan(0.9);
  expect(volumes[1] / volumes[0]).toBeLessThan(1.1);
});

it("applies external coastal forcing through the same physical shore band", () => {
  const volumes: number[] = [];
  for (const samples of [1024, 4096]) {
    const map = coast(samples),
      profile = atlasPhysicalProfile();
    for (let i = 0; i < map.mesh.count; i++) {
      if (map.WaterKindCodes[i] !== 0) continue;
      for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
        const j = map.mesh.neighbors[i * map.mesh.stride + edge];
        if (j >= 0 && map.WaterKindCodes[j] === 1) map.ExternalCoastalForcing[i] = 500;
      }
    }
    externalCoastalForcing(map, physicalContext(157, 0, profile));
    volumes.push(map.SedimentProducedTotal);
    expect(map.ExternalCoastalForcing.every((value) => value === 0)).toBe(true);
    expect(map.SedimentDepositedTotal + map.SedimentExportedTotal).toBeCloseTo(
      map.SedimentProducedTotal,
      -2
    );
  }
  expect(volumes[1] / volumes[0]).toBeGreaterThan(0.9);
  expect(volumes[1] / volumes[0]).toBeLessThan(1.1);
});

it("weights an unresolved shore strip by its physical area", () => {
  const volumes = [1024, 4096].map((samples) => {
    const map = coast(samples),
      profile = atlasPhysicalProfile();
    profile.CoastalActiveWidth = 500;
    expect(map.mesh.spacing).toBeGreaterThan(profile.CoastalActiveWidth);
    coastalErosion(map, physicalContext(157, 0, profile));
    return map.SedimentProducedTotal;
  });
  expect(volumes[1] / volumes[0]).toBeGreaterThan(0.95);
  expect(volumes[1] / volumes[0]).toBeLessThan(1.05);
});

it("keeps separated ocean basins independent during physical smoothing", () => {
  const mesh = createWorldMesh([-50_000, -50_000, 50_000, 50_000], 1024, 0);
  const ocean = Uint8Array.from(mesh.x, (x) => Number(Math.abs(x) > 10_000));
  const input = Float64Array.from(mesh.x, (x) => (x < -10_000 ? 1000 : 0));
  const output = smoothMetric(mesh, input, 35_000, ocean);
  for (let i = 0; i < mesh.count; i++) expect(output[i]).toBeCloseTo(input[i], 7);
});

it("mixes upstream heat, cools it, and retains geothermal source floors", () => {
  const results = [0, 50].map((cooling) => {
    const map = createField(createWorldMesh([-50_000, -10_000, 50_000, 10_000], 512, 0));
    map.WaterKindCodes.fill(1);
    for (let i = 0; i < map.mesh.count; i++) map.Geothermal[i] = map.mesh.x[i] < -20_000 ? 1000 : 0;
    const targets = Int32Array.from(map.mesh.x, (_, i) => alignedNeighbor(map, i, -1, 0));
    transportOceanHeat(map, 15_000, cooling, targets);
    const downstream = [...map.OceanCurrentHeat].filter(
      (_, i) => map.mesh.x[i] > -10_000 && map.mesh.x[i] < 0
    );
    expect(map.OceanCurrentHeat.every((heat) => heat >= 60 && heat <= 860)).toBe(true);
    expect(
      [...map.OceanCurrentHeat].some((heat, i) => map.mesh.x[i] < -30_000 && heat === 860)
    ).toBe(true);
    expect(downstream.some((heat) => heat > 60 && heat < 860)).toBe(true);
    return downstream.reduce((sum, heat) => sum + heat, 0);
  });
  expect(results[1]).toBeLessThan(results[0]);
});

it("keeps downstream heat transport at the same physical scale", () => {
  const reaches = [1024, 4096].map((samples) => {
    const map = createField(createWorldMesh([-50_000, -50_000, 50_000, 50_000], samples, 0));
    map.WaterKindCodes.fill(1);
    for (let i = 0; i < map.mesh.count; i++) map.Geothermal[i] = map.mesh.x[i] < -20_000 ? 1000 : 0;
    const targets = Int32Array.from(map.mesh.x, (_, i) => alignedNeighbor(map, i, -1, 0));
    transportOceanHeat(map, 15_000, 50, targets);
    let excess = 0,
      moment = 0;
    for (let i = 0; i < map.mesh.count; i++) {
      if (map.mesh.x[i] <= -20_000) continue;
      const heat = (map.OceanCurrentHeat[i] - 60) * map.mesh.areas[i];
      excess += heat;
      moment += heat * (map.mesh.x[i] + 20_000);
    }
    return moment / excess;
  });
  expect(reaches[0]).toBeGreaterThan(4000);
  expect(reaches[1] / reaches[0]).toBeGreaterThan(0.85);
  expect(reaches[1] / reaches[0]).toBeLessThan(1.15);
});

it("uses metre amplitudes for margin-shaped coastal relief", () => {
  const map = coast(1024),
    profile = atlasPhysicalProfile();
  map.MarginCodes.fill(1);
  map.BedrockElevation.fill(0);
  map.Elevation.fill(0);
  coastalDetail(map, physicalContext(157, 0, profile));
  const relief = Math.max(...map.Elevation.map((height) => Math.abs(height) / 1024));
  expect(relief).toBeGreaterThan(1);
  expect(relief).toBeLessThanOrEqual(profile.CoastalDetailPassiveAmplitude);
});
