import { expect, it } from "vitest";
import type { Band } from "@atlas/domain";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { marineSedimentation } from "./continentalMargins";
import { createField, type PhysicalField } from "./field";
import { sedimentTransport } from "./fluvial";
import { massWasting } from "./massWasting";
import { units } from "./math";
import { createMesh } from "./mesh";
import { validateLandscape } from "./surface";
import { createWorldMesh } from "./worldMesh";

const volume = (map: PhysicalField, channel: Band) =>
  map.coverage.reduce(channel, (sum, depth, i) => sum + (depth / 1024) * map.mesh.area(i), 0);

it("keeps marine sediment allocation within fractional and continental-volume budgets", () => {
  for (const exported of [0.125, 148_221_571_959_258.8, 1e18]) {
    const map = createField(createWorldMesh([0, 0, 4_000_000, 2_000_000], 4096, 0));
    map.CoastalMarginCodes.fill(1);
    map.Elevation.fill(units(-300));
    map.BedrockElevation.copyFrom(map.Elevation);
    for (let i = 0; i < map.mesh.count; i++) map.OceanMarginDistance.set(i, 1 + (i % 97) * 10_000);
    map.SedimentProducedTotal = exported;
    map.SedimentExportedTotal = exported;
    marineSedimentation(map, physicalContext(1, 0, atlasPhysicalProfile()));
    expect(map.SedimentExportedTotal).toBeGreaterThanOrEqual(0);
    expect(map.SedimentExportedTotal).toBeLessThan(exported);
    expect(map.SedimentDepositedTotal).toBeGreaterThan(0);
    const accounted = map.SedimentDepositedTotal + map.SedimentExportedTotal;
    expect(Math.abs(accounted - exported) / exported).toBeLessThan(1e-11);
    expect(
      Math.abs(volume(map, map.SedimentThickness) - map.SedimentDepositedTotal) / exported
    ).toBeLessThan(1e-11);
    expect(() => validateLandscape(map)).not.toThrow();
    if (exported === 1e18) expect(map.SedimentExportedTotal).toBeGreaterThan(0);
  }
});

function routedSediment(cells: number) {
  // A prescribed 40 km routing graph isolates transport from drainage discovery.
  const mesh = createMesh(cells, 0);
  const live: number[] = [];
  for (let i = 0; i < mesh.count; i++) if (mesh.membership(i) === 1) live.push(i);
  const position = new Map(live.map((cell, k) => [cell, k])),
    spacing = 40_000 / cells,
    area = 400_000_000 / cells;
  Object.defineProperty(mesh, "spacing", { value: spacing });
  mesh.area = () => area;
  mesh.contentArea = () => area;
  mesh.x = (i) => ((position.get(i) ?? 0) + 0.5) * spacing;
  mesh.y = () => 0;
  mesh.cellWidth = () => spacing;
  mesh.cellHeight = () => area / spacing;
  const map = createField(mesh);
  for (let k = 0; k < live.length - 1; k++) map.FlowTargets.set(live[k], live[k + 1]);
  map.SedimentSupply.set(live[0], (1000 * 1024) / area);
  map.SedimentProducedTotal = 1000;
  sedimentTransport(map, physicalContext(1, 0, atlasPhysicalProfile()));
  expect(
    map.coverage.reduce(map.SedimentSupply, (any, supply) => (supply === 0 ? any : 1), 0)
  ).toBe(0);
  expect(map.SedimentDepositedTotal + map.SedimentExportedTotal).toBeCloseTo(1000, 8);
  return map.SedimentExportedTotal;
}

it("deposits the same sediment over the same physical river length at finer sampling", () => {
  const exported = [4, 8, 16].map(routedSediment);
  expect(exported[0]).toBeGreaterThan(0);
  expect(exported[0]).toBeLessThan(1000);
  expect(exported[1]).toBeCloseTo(exported[0], 8);
  expect(exported[2]).toBeCloseTo(exported[0], 8);
});

function moundMeasures(map: PhysicalField) {
  const total = volume(map, map.Elevation);
  const moment = map.coverage.reduce(
    map.Elevation,
    (sum, height, i) =>
      sum + (height / 1024) * map.mesh.area(i) * (map.mesh.x(i) ** 2 + map.mesh.y(i) ** 2),
    0
  );
  return {
    volume: total,
    radius: Math.sqrt(moment / total),
    peak: map.coverage.reduce(
      map.Elevation,
      (highest, height) => Math.max(highest, height / 1024),
      0
    ),
  };
}

function relaxedMound(samples: number) {
  const map = createField(createWorldMesh([-8000, -8000, 8000, 8000], samples, 0));
  map.RockResistance.fill(1000);
  for (let i = 0; i < map.mesh.count; i++) {
    const height = units(
      3000 * Math.exp(-(map.mesh.x(i) ** 2 + map.mesh.y(i) ** 2) / (2 * 1000 ** 2))
    );
    map.BedrockElevation.set(i, height);
    map.Elevation.set(i, height);
  }
  const before = moundMeasures(map);
  massWasting(map, physicalContext(1, 0, atlasPhysicalProfile()));
  const after = moundMeasures(map);
  expect(Math.abs(after.volume - before.volume) / before.volume).toBeLessThan(1e-11);
  expect(map.SedimentDepositedTotal).toBeGreaterThan(0);
  expect(
    Math.abs(map.SedimentProducedTotal - map.SedimentDepositedTotal) / before.volume
  ).toBeLessThan(1e-11);
  expect(after.peak).toBeLessThan(before.peak);
  expect(after.radius).toBeGreaterThan(before.radius);
  expect(() => validateLandscape(map)).not.toThrow();
  return { spreading: after.radius - before.radius, peak: after.peak };
}

it("relaxes a localized hillslope over a physical reach while conserving area-weighted material", () => {
  const coarse = relaxedMound(2048),
    fine = relaxedMound(8192);
  expect(fine.spreading / coarse.spreading).toBeGreaterThan(0.85);
  expect(fine.spreading / coarse.spreading).toBeLessThan(1.15);
  expect(fine.peak / coarse.peak).toBeGreaterThan(0.9);
  expect(fine.peak / coarse.peak).toBeLessThan(1.1);
});
