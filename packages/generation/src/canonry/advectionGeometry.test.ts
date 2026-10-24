import { expect, it } from "vitest";
import { createField } from "./field";
import { createWorldMesh } from "./worldMesh";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { physicalSampler } from "./physicalMetric";
import { plateAdvection } from "./advection";
import { buildTransportPlan } from "./transportPlan";
import { transportHistory } from "./transportHistory";

function fixture() {
  const map = createField(createWorldMesh([-100_000, -100_000, 100_000, 100_000], 512, 25_000)),
    profile = { ...atlasPhysicalProfile(), PlateDriftPerEpoch: 20_000, PlateDriftDecay: 1000 };
  return { map, context: physicalContext(1, 0, profile) };
}
it("keeps nearby geological points together across a cell motion boundary", () => {
  const { map, context } = fixture(),
    mesh = map.mesh;
  for (let i = 0; i < mesh.count; i++) map.CrustMotionX[i] = mesh.x[i] < 0 ? 1000 : -1000;
  const i = Array.from(mesh.x.keys()).find(
      (i) =>
        mesh.x[i] < 0 &&
        Array.from(mesh.neighbors.slice(i * 3, i * 3 + 3)).some((j) => j >= 0 && mesh.x[j] > 0)
    )!,
    j = Array.from(mesh.neighbors.slice(i * 3, i * 3 + 3)).find((j) => j >= 0 && mesh.x[j] > 0)!,
    x = (mesh.x[i] + mesh.x[j]) / 2,
    y = (mesh.y[i] + mesh.y[j]) / 2;
  map.events = [-0.01, 0.01].map((offset, index) => ({
    id: `impact:${index}`,
    kind: "impact" as const,
    x: x + offset,
    y,
    radius: 100,
    epoch: 0,
    strength: 1000,
  }));
  const before = structuredClone(map.events),
    velocity = physicalSampler(mesh, map.CrustMotionX);
  const expected = before.map((p) => p.x + velocity(p.x, p.y) * 20);
  plateAdvection(map, context);
  map.events.forEach((event, index) => expect(event.x).toBeCloseTo(expected[index], 7));
  expect(Math.abs(map.events[1].x - map.events[0].x)).toBeLessThan(1);
});
it("follows continuous deformation along a long fault and preserves identity and stationary plumes", () => {
  const { map, context } = fixture(),
    mesh = map.mesh;
  map.CrustMotionY.set(Float64Array.from(mesh.x, (x) => Math.round(800 * Math.sin(x / 20_000))));
  map.faults.push({
    id: "fault:test",
    width: 1000,
    coordinates: [
      [-60_000, 0],
      [60_000, 0],
    ],
  });
  map.events.push({
    id: "plume:test",
    kind: "plume",
    x: 0,
    y: 0,
    radius: 100,
    epoch: 0,
    strength: 1000,
  });
  const velocity = physicalSampler(mesh, map.CrustMotionY);
  plateAdvection(map, context);
  const fault = map.faults[0];
  expect(fault.id).toBe("fault:test");
  expect(fault.coordinates.length).toBeGreaterThan(10);
  for (const [x, y] of fault.coordinates) expect(y).toBeCloseTo(velocity(x, 0) * 20, 7);
  expect(fault.coordinates.some(([, y]) => Math.abs(y) > 10_000)).toBe(true);
  expect(map.events[0].y).toBe(0);
});

function unequalBlocks(samples: number) {
  const map = createField(createWorldMesh([-100000, -100000, 100000, 100000], samples, 25000));
  const mesh = map.mesh;
  for (let i = 0; i < mesh.count; i++) {
    const x = mesh.x[i],
      y = mesh.y[i];
    if (Math.abs(x) > 60000 || Math.abs(y) > 40000) continue;
    const block = x < 0 ? 1 : x < 15000 ? 2 : 3;
    map.CrustAssemblyIds[i] = block;
    map.CrustContinentalFraction[i] = 1000;
    map.CrustSuturePairIds[i] = (block << 16) | (block + 1);
    map.CrustSutureStrength[i] = block * 100;
    map.SedimentThickness[i] = block * 1024;
    map.CumulativeFluvialErosion[i] = block * 2048;
    map.MaximumIceThickness[i] = block * 500;
    map.CrustMotionX[i] = block === 1 ? 500 : -500;
    map.CrustMotionY[i] = block === 2 ? 500 : 0;
  }
  return map;
}

it.each([1024, 4096])("carries a narrow block beside larger blocks at %s samples", (samples) => {
  const map = unequalBlocks(samples),
    mesh = map.mesh;
  const integral = (values: Float64Array) =>
    values.reduce((sum, value, i) => sum + value * mesh.areas[i], 0);
  const sediment = integral(map.SedimentThickness);
  const erosion = integral(map.CumulativeFluvialErosion);
  const plan = buildTransportPlan(map, 5000);
  transportHistory(map, plan);
  expect(Math.abs(integral(map.SedimentThickness) - sediment) / sediment).toBeLessThan(1e-11);
  expect(Math.abs(integral(map.CumulativeFluvialErosion) - erosion) / erosion).toBeLessThan(1e-11);
  expect(new Set(map.CrustAssemblyIds)).toEqual(new Set([0, 1, 2, 3]));
  const pairs = new Set([0, 65538, 131075, 196612]);
  expect(new Set(map.CrustSuturePairIds)).toEqual(pairs);
  let narrowInterior = 0;
  for (let i = 0; i < mesh.count; i++) {
    expect(map.MaximumIceThickness[i]).toBeLessThanOrEqual(1500);
    const block = map.CrustAssemblyIds[i];
    if (block > 0) {
      // Edge cells mix with the surrounding oceanic material. Sutures retain their
      // own provenance rather than becoming a label of the winning assembly.
      expect(map.CrustContinentalFraction[i]).toBeGreaterThan(0);
      expect(map.CrustContinentalFraction[i]).toBeLessThanOrEqual(1000);
      expect(pairs.has(map.CrustSuturePairIds[i])).toBe(true);
      expect(map.CrustSutureStrength[i]).toBeGreaterThanOrEqual(0);
      if (block === 2 && map.CrustContinentalFraction[i] === 1000) narrowInterior++;
    }
  }
  expect(narrowInterior).toBeGreaterThan(0);
});
