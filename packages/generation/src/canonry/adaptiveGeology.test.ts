import { expect, it } from "vitest";
import { createAdaptiveTopology, rectangle, refineAdaptiveTopology } from "@atlas/domain";
import { adaptivePhysicalMesh } from "./adaptiveMesh";
import { createField } from "./field";
import { smoothMetric } from "./metricSmoothing";
import { remeshPhysical } from "./physicalRemesh";
import { massWasting } from "./massWasting";
import { physicalContext } from "./context";
import { atlasPhysicalProfile } from "./atlasProfile";
import { buildTransportPlan } from "./transportPlan";
import { transportHistory } from "./transportHistory";
import { orogenicConstruction } from "./orogeny";
import { metricOperator, metricProduct } from "./metricOperator";
import { volcanicConstruction } from "./volcanism";
import { impactCratering, plannedImpacts } from "./impacts";
import { physicalSampler } from "./physicalMetric";
import { plateAdvection } from "./advection";

const bounds: [number, number, number, number] = [-50_000, -50_000, 50_000, 50_000];
function fixture() {
  const topology = createAdaptiveTopology(bounds, {
    maximumSize: 12_500,
    minimumSize: 3125,
    refine: ([x, y, right, top]) => x < 20_000 && right > 0 && y < 20_000 && top > 0,
  });
  return createField(adaptivePhysicalMesh(topology, rectangle(bounds)));
}
function hillsideFixture() {
  const box: [number, number, number, number] = [-2000, -2000, 2000, 2000];
  const topology = createAdaptiveTopology(box, {
    maximumSize: 500,
    minimumSize: 125,
    refine: ([x, , right]) => x < 500 && right > -500,
  });
  return createField(adaptivePhysicalMesh(topology, rectangle(box)));
}
const integral = (values: Float64Array, areas: Float64Array) =>
  values.reduce((sum, value, i) => sum + value * areas[i], 0);

it.each([0, 2500, 20_000])(
  "matches the analytical four-cell diffusion solution at reach %s",
  (reach) => {
    const box: [number, number, number, number] = [0, 0, 20_000, 20_000];
    const topology = createAdaptiveTopology(box, { maximumSize: 10_000, minimumSize: 10_000 });
    const mesh = adaptivePhysicalMesh(topology, rectangle(box));
    const input = Float64Array.from(mesh.x, (x) => 7 + (x < 0 ? -3 : 3));
    const output = smoothMetric(mesh, input, reach);
    // Two equal square columns exchange through one face: contrast is divided by
    // 1 + 2 L²/h². This expectation does not call the assembled matrix/operator.
    const contrast = 3 / (1 + 2 * (reach / 10_000) ** 2);
    for (let i = 0; i < mesh.count; i++)
      expect(output[i]).toBeCloseTo(7 + (mesh.x[i] < 0 ? -contrast : contrast), 9);
  }
);

it("diffuses support across coarse/fine faces without creating crust", () => {
  const map = fixture();
  const input = Float64Array.from(map.mesh.x, (x, i) =>
    Math.exp(-(x ** 2 + map.mesh.y[i] ** 2) / 2e8)
  );
  const output = smoothMetric(map.mesh, input, 15_000);
  expect(integral(output, map.mesh.areas)).toBeCloseTo(integral(input, map.mesh.areas), -2);
  expect(Math.max(...output)).toBeLessThan(Math.max(...input));
  const constant = smoothMetric(map.mesh, new Float64Array(map.mesh.count).fill(7), 15_000);
  expect([...constant].every((v) => Math.abs(v - 7) < 1e-9)).toBe(true);
});

it("solves the fine physical equation at high coarse/fine contrast and long influence length", () => {
  const topology = createAdaptiveTopology(bounds, {
    maximumSize: 12_500,
    minimumSize: 390.625,
    refine: ([x, y, right, top]) => x < 1500 && right > -1500 && y < 10_000 && top > -10_000,
  });
  const mesh = adaptivePhysicalMesh(topology, rectangle(bounds));
  const input = Float64Array.from(
    mesh.x,
    (x, i) => Math.sin(x / 9000) + Math.cos(mesh.y[i] / 7000)
  );
  const result = smoothMetric(mesh, input, 200_000);
  const matrix = metricOperator(mesh, 200_000),
    applied = new Float64Array(mesh.count);
  metricProduct(matrix, result, applied);
  let residual = 0,
    magnitude = 0;
  for (let i = 0; i < result.length; i++) {
    const rhs = input[i] * mesh.areas[i];
    residual += (applied[i] - rhs) ** 2 / matrix.diagonal[i];
    magnitude += rhs ** 2 / matrix.diagonal[i];
  }
  expect(residual / magnitude).toBeLessThan(1e-12);
});

it("remeshes evolved material and provenance without restoring an initial event", () => {
  const map = fixture();
  map.BedrockElevation.set(Float64Array.from(map.mesh.x, (x) => x / 10));
  map.SedimentThickness.fill(100);
  map.CrustAssemblyIds.set(Int32Array.from(map.mesh.x, (x) => (x < 0 ? 3 : 8)));
  map.CumulativeFluvialErosion.fill(400);
  const refined = refineAdaptiveTopology(map.mesh.topology!, [0], 1000);
  const next = remeshPhysical(map, refined, rectangle(bounds));
  expect(integral(next.SedimentThickness, next.mesh.areas)).toBeCloseTo(
    integral(map.SedimentThickness, map.mesh.areas),
    -2
  );
  expect(integral(next.BedrockElevation, next.mesh.areas)).toBeCloseTo(
    integral(map.BedrockElevation, map.mesh.areas),
    -2
  );
  expect(new Set(next.CrustAssemblyIds)).toEqual(new Set([3, 8]));
  expect([...next.CumulativeFluvialErosion].every((v) => v === 400)).toBe(true);
  expect([...next.FlowTargets].every((v) => v === -1)).toBe(true);
  expect(
    [...next.Elevation].every((v, i) => v === next.BedrockElevation[i] + next.SedimentThickness[i])
  ).toBe(true);
});

it("moves hillslope material conservatively across unequal control volumes", () => {
  const map = hillsideFixture();
  map.BedrockElevation.set(Float64Array.from(map.mesh.x, (x) => 1024 * (3500 - Math.abs(x) * 2)));
  map.Elevation.set(map.BedrockElevation);
  map.RockResistance.fill(1000);
  const before = integral(map.Elevation, map.mesh.areas);
  const profile = atlasPhysicalProfile();
  profile.MassWastingIterations = 1;
  massWasting(map, physicalContext(1, 0, profile));
  expect(integral(map.Elevation, map.mesh.areas)).toBeCloseTo(before, -4);
  expect(map.SedimentProducedTotal).toBeGreaterThan(0);
});

it("preserves a gentle mountain flank while relaxing genuinely unstable rock", () => {
  for (const slope of [0.15, 2]) {
    const map = hillsideFixture();
    map.RockResistance.fill(1000);
    map.Elevation.set(Float64Array.from(map.mesh.x, (x) => slope * x * 1024));
    map.BedrockElevation.set(map.Elevation);
    const before = map.Elevation.slice(),
      volume = integral(before, map.mesh.areas);
    massWasting(map, physicalContext(42, 0, atlasPhysicalProfile()));
    if (slope === 0.15) expect(map.Elevation).toEqual(before);
    else expect(map.Elevation.some((value, i) => value !== before[i])).toBe(true);
    expect(integral(map.Elevation, map.mesh.areas)).toBeCloseTo(volume, -2);
  }
});

it("retains lake inventory and a single hydrostatic level when its floor is refined", () => {
  const map = fixture();
  map.BedrockElevation.set(Float64Array.from(map.mesh.x, (x) => x / 10));
  map.Elevation.set(map.BedrockElevation);
  map.WaterKindCodes.fill(2);
  map.WaterBodyIds.fill(17);
  map.WaterSurfaceElevations.fill(10_000);
  map.WaterDepths.set(Float64Array.from(map.Elevation, (floor) => 10_000 - floor));
  const before = integral(map.WaterDepths, map.mesh.areas);
  const refined = refineAdaptiveTopology(map.mesh.topology!, [0, 1, 2], 1000);
  const next = remeshPhysical(map, refined, rectangle(bounds));
  expect(integral(next.WaterDepths, next.mesh.areas)).toBeCloseTo(before, -2);
  expect(new Set(next.WaterSurfaceElevations).size).toBe(1);
  expect(
    [...next.WaterDepths].every(
      (depth, i) => depth === next.WaterSurfaceElevations[i] - next.Elevation[i]
    )
  ).toBe(true);
});

it("retains ordered ice maxima when history is refined without another glaciation", () => {
  const map = fixture();
  map.MaximumIceFlux.set(
    Float64Array.from(
      map.mesh.x,
      (x, i) => 10 + Math.abs(Math.sin(x / 1700 + map.mesh.y[i] / 2300)) * 1e6
    )
  );
  map.MaximumGroundedIceFlux.set(
    Float64Array.from(map.MaximumIceFlux, (flux, i) =>
      Math.min(flux, Math.abs(Math.cos(i * 1.71)) * 9e5)
    )
  );
  const topology = refineAdaptiveTopology(map.mesh.topology!, [...map.mesh.cellToLeaf], 1000);
  const next = remeshPhysical(map, topology, rectangle(bounds));
  for (let i = 0; i < next.mesh.count; i++)
    expect(next.MaximumGroundedIceFlux[i]).toBeLessThanOrEqual(next.MaximumIceFlux[i]);
});

it("advects entire material footprints across coarse/fine faces", () => {
  const map = fixture();
  map.CrustMotionX.fill(1000);
  map.SedimentThickness.set(
    Float64Array.from(map.mesh.x, (x, i) =>
      Math.abs(x) < 20_000 && Math.abs(map.mesh.y[i]) < 20_000 ? 100 : 0
    )
  );
  const before = integral(map.SedimentThickness, map.mesh.areas);
  const plan = buildTransportPlan(map, 2000);
  transportHistory(map, plan);
  expect(integral(map.SedimentThickness, map.mesh.areas)).toBeCloseTo(before, -2);
  expect(Math.max(...map.SedimentThickness)).toBeLessThanOrEqual(100 + 1e-9);
  expect(plan.targets.length).toBeGreaterThan(map.mesh.count);
});

it("constructs collision relief and rift thinning from the same physical boundary inputs", () => {
  for (const code of [1, 2]) {
    const map = fixture(),
      profile = atlasPhysicalProfile();
    profile.RiftShoulderDistance = 20_000;
    profile.CollisionRangeWidth = 40_000;
    map.CrustThickness.fill(4_000 * 1024);
    map.CrustContinentalFraction.fill(1000);
    map.RockResistance.fill(1000);
    for (let i = 0; i < map.mesh.count; i++) {
      if (Math.abs(map.mesh.x[i]) > 12_500) continue;
      map.TectonicBoundaryCodes[i] = code;
      map.TectonicBoundaryPairIds[i] = 65538;
      map.TectonicStrain[i] = 800;
      map.CrustCollisionIntensity[i] = code === 1 ? 900 : 0;
    }
    orogenicConstruction(map, physicalContext(42, 0, profile));
    expect(map.OrogenicConstruction.some((v) => v > 0)).toBe(true);
    if (code === 1) {
      expect(map.BedrockElevation.some((v) => v > 0)).toBe(true);
      expect(map.RockResistance.some((v) => v > 1000)).toBe(true);
    } else expect(map.OrogenicConstruction.some((v) => v < 0)).toBe(true);
  }
});

it.each(["volcano", "crater"])(
  "retains generated %s relief through relaxation and follows its advected location",
  (kind) => {
    const box: [number, number, number, number] = [-32000, -32000, 32000, 32000];
    const p = atlasPhysicalProfile();
    p.MantlePlumeDriftPerEpoch = 0;
    p.VolcanicCalderaChance = 0;
    p.ImpactCraterCount = 1;
    p.ImpactPrimordialShare = 1000;
    p.ImpactMinimumRadius = p.ImpactMaximumRadius = 8000;
    const context = physicalContext(42, 0, p);
    const base = createField(
      adaptivePhysicalMesh(
        createAdaptiveTopology(box, { maximumSize: 4000, minimumSize: 4000 }),
        rectangle(box)
      )
    );
    const center = kind === "crater" ? plannedImpacts(base, context)[0] : { x: 0, y: 0 };
    const topology = createAdaptiveTopology(box, {
      maximumSize: 4000,
      minimumSize: 250,
      refine: ([x, y, r, t]) =>
        Math.hypot(
          Math.max(x - center.x, 0, center.x - r),
          Math.max(y - center.y, 0, center.y - t)
        ) < 12000,
    });
    const map = createField(adaptivePhysicalMesh(topology, rectangle(box)));
    map.RockResistance.fill(1000);
    map.CrustThickness.fill(4000 * 1024);
    if (kind === "volcano") {
      map.events.push({
        id: "plume:test:1",
        kind: "plume",
        x: 0,
        y: 0,
        radius: 8000,
        epoch: -1,
        strength: 1000,
      });
      volcanicConstruction(map, context);
    } else impactCratering(map, context);
    const at = physicalSampler(map.mesh, map.Elevation);
    if (kind === "volcano") expect(at(center.x, center.y) / 1024).toBeGreaterThan(1000);
    else expect(at(center.x, center.y) / 1024).toBeLessThan(-200);
    const before = map.Elevation.slice();
    massWasting(map, context);
    expect(map.Elevation).toEqual(before);
    map.CrustMotionX.fill(1000);
    map.CrustMotionY.fill(0);
    p.PlateDriftPerEpoch = 250;
    p.PlateDriftDecay = 1000;
    const event = map.events.find((e) => e.kind != "plume")!;
    const previous = event.x;
    plateAdvection(map, context);
    expect(event.x).toBe(previous + 250);
    const moved = physicalSampler(map.mesh, map.Elevation);
    if (kind === "volcano") expect(moved(event.x, event.y) / 1024).toBeGreaterThan(900);
    else expect(moved(event.x, event.y) / 1024).toBeLessThan(-190);
  }
);
