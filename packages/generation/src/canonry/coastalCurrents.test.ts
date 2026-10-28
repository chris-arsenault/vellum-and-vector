import { expect, it } from "vitest";
import { createWorldMesh } from "./worldMesh";
import { createField, type PhysicalField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { coastalErosion, externalCoastalForcing } from "./coastalEvolution";
import { coastalDetail } from "./coastalDetail";
import { smoothMetric } from "./metricSmoothing";
import { transportOceanHeat } from "./currents";
import { alignedNeighbor } from "./atmosphere";
import { createAdaptiveWorldMesh } from "./adaptiveMesh";
import { workingValues } from "./physicalNumerics";

function coast(samples: number) {
  const size = 100_000 / Math.sqrt(samples);
  const map = createField(
    createAdaptiveWorldMesh([0, 0, 100_000, 100_000], { maximumSize: size, minimumSize: size }, 0)
  );
  for (let i = 0; i < map.mesh.count; i++) {
    map.WaterKindCodes.set(i, map.mesh.x(i) < 0 ? 1 : 0);
    map.WaveExposure.set(i, 1000);
    map.CrustTypeCodes.set(i, 2);
    const height = (map.mesh.x(i) < 0 ? -100 : 100) * 1024;
    map.BedrockElevation.set(i, height);
    map.Elevation.set(i, height);
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
    let width = -Infinity;
    for (let i = 0; i < map.mesh.count; i++)
      if (map.CumulativeCoastalErosion.get(i) > 0) width = Math.max(width, map.mesh.x(i));
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
      if (map.WaterKindCodes.get(i) !== 0) continue;
      for (let edge = 0; edge < map.mesh.degree(i); edge++) {
        const j = map.mesh.neighbor(i, edge);
        if (j >= 0 && map.WaterKindCodes.get(j) === 1) map.ExternalCoastalForcing.set(i, 500);
      }
    }
    externalCoastalForcing(map, physicalContext(157, 0, profile));
    volumes.push(map.SedimentProducedTotal);
    let spent = true;
    for (let i = 0; i < map.mesh.count; i++)
      if (map.ExternalCoastalForcing.get(i) !== 0) spent = false;
    expect(spent).toBe(true);
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
  const map = createField(createWorldMesh([-50_000, -50_000, 50_000, 50_000], 1024, 0)),
    mesh = map.mesh;
  const ocean = workingValues(map, "uint8", "test:ocean", (i) =>
    Number(Math.abs(mesh.x(i)) > 10_000)
  );
  const input = workingValues(map, "float64", "test:input", (i) =>
    mesh.x(i) < -10_000 ? 1000 : 0
  );
  const output = smoothMetric(map, input, 35_000, ocean);
  for (let i = 0; i < mesh.count; i++) expect(output.get(i)).toBeCloseTo(input.get(i), 7);
});

it("mixes upstream heat, cools it, and retains geothermal source floors", () => {
  const results = [0, 50].map((cooling) => {
    const map = createField(createWorldMesh([-50_000, -10_000, 50_000, 10_000], 512, 0)),
      mesh = map.mesh;
    map.WaterKindCodes.fill(1);
    for (let i = 0; i < mesh.count; i++) map.Geothermal.set(i, mesh.x(i) < -20_000 ? 1000 : 0);
    const targets = workingValues(map, "int32", "test:targets", (i) =>
      alignedNeighbor(map, i, -1, 0)
    );
    transportOceanHeat(map, 15_000, cooling, targets);
    const summary = heatSummary(map);
    expect(summary.withinRange).toBe(true);
    expect(summary.floorRetained).toBe(true);
    expect(summary.intermediate).toBe(true);
    return summary.total;
  });
  expect(results[1]).toBeLessThan(results[0]);
});
/** Range, floor and mixing facts of the transported heat, and its total just east of the source. */
function heatSummary(map: PhysicalField) {
  const mesh = map.mesh,
    inRange = (heat: number) => heat >= 60 && heat <= 860,
    mixed = (heat: number) => heat > 60 && heat < 860;
  let withinRange = true,
    floorRetained = false,
    intermediate = false,
    total = 0;
  for (let i = 0; i < mesh.count; i++) {
    if (mesh.membership(i) === 0) continue;
    const heat = map.OceanCurrentHeat.get(i),
      x = mesh.x(i);
    withinRange &&= inRange(heat);
    floorRetained ||= x < -30_000 && heat === 860;
    if (x <= -10_000 || x >= 0) continue;
    intermediate ||= mixed(heat);
    total += heat;
  }
  return { withinRange, floorRetained, intermediate, total };
}

it("keeps downstream heat transport at the same physical scale", () => {
  const reaches = [1024, 4096].map((samples) => {
    const map = createField(createWorldMesh([-50_000, -50_000, 50_000, 50_000], samples, 0)),
      mesh = map.mesh;
    map.WaterKindCodes.fill(1);
    for (let i = 0; i < mesh.count; i++) map.Geothermal.set(i, mesh.x(i) < -20_000 ? 1000 : 0);
    const targets = workingValues(map, "int32", "test:targets", (i) =>
      alignedNeighbor(map, i, -1, 0)
    );
    transportOceanHeat(map, 15_000, 50, targets);
    let excess = 0,
      moment = 0;
    for (let i = 0; i < mesh.count; i++) {
      if (mesh.membership(i) === 0 || mesh.x(i) <= -20_000) continue;
      const heat = (map.OceanCurrentHeat.get(i) - 60) * mesh.area(i);
      excess += heat;
      moment += heat * (mesh.x(i) + 20_000);
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
  let relief = -Infinity;
  for (let i = 0; i < map.mesh.count; i++)
    relief = Math.max(relief, Math.abs(map.Elevation.get(i)) / 1024);
  expect(relief).toBeGreaterThan(1);
  expect(relief).toBeLessThanOrEqual(profile.CoastalDetailPassiveAmplitude);
});
