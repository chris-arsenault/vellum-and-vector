import { expect, it } from "vitest";
import {
  createAdaptiveTopology,
  reconstructAdaptive,
  rectangle,
  refineAdaptiveTopology,
  residentBand,
  sampleAdaptive,
  type AdaptiveLattice,
  type Band,
} from "@atlas/domain";
import { adaptivePhysicalMesh } from "./adaptiveMesh";
import { createField, type PhysicalField } from "./field";
import { smoothMetric } from "./metricSmoothing";
import { remeshPhysical } from "./physicalRemesh";
import { massWasting } from "./massWasting";
import { physicalContext } from "./context";
import { atlasPhysicalProfile } from "./atlasProfile";
import { buildTransportPlan } from "./transportPlan";
import { transportHistory } from "./transportHistory";
import { orogenicConstruction } from "./orogeny";
import { metricArray, metricOperator, metricProduct } from "./metricOperator";
import { releaseWorking, workingValues } from "./physicalNumerics";
import { volcanicConstruction } from "./volcanism";
import { impactCratering, plannedImpacts } from "./impacts";
import { physicalSampler } from "./physicalMetric";
import { plateAdvection } from "./advection";
import { landformClassification } from "./landforms";
import { glacialLandforms } from "./glacialLandforms";
import { Landform } from "./codes";

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
const integral = (map: PhysicalField, values: Band) =>
  map.coverage.reduce(values, (sum, value, i) => sum + value * map.mesh.area(i), 0);
/** Number of cells whose value satisfies the test. */
const countWhere = (map: PhysicalField, band: Band, test: (value: number) => boolean) =>
  map.coverage.reduce(band, (n, value) => n + (test(value) ? 1 : 0), 0);
const maximum = (map: PhysicalField, band: Band) =>
  map.coverage.reduce(band, (highest, value) => Math.max(highest, value), -Infinity);
/** Write `value(i)` into every cell of the band. */
function assign(map: PhysicalField, band: Band, value: (i: number) => number) {
  for (let i = 0; i < map.mesh.count; i++) band.set(i, value(i));
}

it("retains seabed, flooded glacial valleys, lakes and glacial landforms during classification", () => {
  const map = fixture();
  const expected = [Landform.Seabed, Landform.Fjord, Landform.Basin, Landform.Moraine];
  const marks = () => {
    for (let i = 0; i < map.mesh.count; i++) {
      const kind = i % 4;
      map.WaterKindCodes.set(i, kind < 2 ? 1 : kind === 2 ? 2 : 0);
      map.LandformCodes.set(i, kind === 1 ? Landform.UValley : kind === 3 ? Landform.Moraine : 0);
    }
  };
  // A shallow trough along y = 0: land rises on both flanks within a fjord's half-width, and
  // no summit is prominent enough to be a peak.
  assign(map, map.Elevation, (i) => ((Math.abs(map.mesh.y(i)) - 2000) * 1024) / 1000);
  marks();
  landformClassification(map, physicalContext(42, 0, atlasPhysicalProfile()));
  for (let i = 0; i < map.mesh.count; i++) expect(map.LandformCodes.get(i)).toBe(expected[i % 4]);
  // Scoured open shelf with no flanking land is seabed.
  map.Elevation.fill(-500 * 1024);
  marks();
  landformClassification(map, physicalContext(42, 0, atlasPhysicalProfile()));
  for (let i = 1; i < map.mesh.count; i += 4)
    expect(map.LandformCodes.get(i)).toBe(Landform.Seabed);
});

it("keeps glacial landforms to terminus till, deep troughs and mountain ice heads", () => {
  const map = fixture(),
    p = atlasPhysicalProfile(),
    till = map.mesh.count >> 1;
  for (let i = 0; i < map.mesh.count; i++) {
    map.Elevation.set(i, 500 * 1024);
    map.MaximumGroundedIceFlux.set(i, p.GlacierFluxThreshold);
    // A level ice-sheet plateau, river and slope deposition everywhere, shallow scour.
    map.MaximumIceThickness.set(i, 840);
    map.CumulativeDeposition.set(i, 20 * 1024);
    map.CumulativeGlacialErosion.set(i, 2 * 1024);
    map.RiverOrders.set(i, 1);
  }
  map.CumulativeGlacialDeposition.set(till, 12 * 1024);
  glacialLandforms(map, physicalContext(42, 0, p));
  for (let i = 0; i < map.mesh.count; i++)
    expect(map.LandformCodes.get(i)).toBe(i === till ? Landform.Moraine : 0);
  map.CumulativeGlacialErosion.fill(p.UValleyMinimumGlacialErosion * 1024);
  glacialLandforms(map, physicalContext(42, 0, p));
  expect(countWhere(map, map.LandformCodes, (code) => code === Landform.UValley)).toBe(
    map.mesh.count - 1
  );
});

it("samples an immutable physical surface lazily with the same coarse/fine reconstruction", () => {
  const map = fixture(),
    mesh = map.mesh;
  assign(map, map.Elevation, (i) => 200 + Math.sin(mesh.x(i) / 10000) * Math.cos(mesh.y(i) / 9000));
  const expected = reconstructAdaptive(
    mesh.topology!,
    residentBand(
      "float64",
      Float64Array.from((mesh as AdaptiveLattice).leafCells(), (cell) => map.Elevation.get(cell))
    )
  );
  // physicalSampler reads the band it is given; the immutable surface is a copy-on-write snapshot.
  const at = physicalSampler(mesh, map.Elevation.snapshot());
  map.Elevation.fill(-999);
  for (let y = -49000; y < 50000; y += 7319)
    for (let x = -49000; x < 50000; x += 6173)
      expect(at(x, y)).toBeCloseTo(
        sampleAdaptive(expected, x + mesh.origin[0], y + mesh.origin[1]),
        10
      );
  expect(at(60000, 0)).toBeNaN();
});

it.each([0, 2500, 20_000])(
  "matches the analytical four-cell diffusion solution at reach %s",
  (reach) => {
    const box: [number, number, number, number] = [0, 0, 20_000, 20_000];
    const topology = createAdaptiveTopology(box, { maximumSize: 10_000, minimumSize: 10_000 });
    const mesh = adaptivePhysicalMesh(topology, rectangle(box)),
      map = createField(mesh);
    const input = workingValues(map, "float64", "test:input", (i) => 7 + (mesh.x(i) < 0 ? -3 : 3));
    const output = smoothMetric(map, input, reach);
    // Two equal square columns exchange through one face: contrast is divided by
    // 1 + 2 L²/h². This expectation does not call the assembled matrix/operator.
    const contrast = 3 / (1 + 2 * (reach / 10_000) ** 2);
    for (let i = 0; i < mesh.count; i++)
      expect(output.get(i)).toBeCloseTo(7 + (mesh.x(i) < 0 ? -contrast : contrast), 9);
    releaseWorking(map, input, output);
  }
);

it("diffuses support across coarse/fine faces without creating crust", () => {
  const map = fixture();
  const input = workingValues(map, "float64", "test:input", (i) =>
    Math.exp(-(map.mesh.x(i) ** 2 + map.mesh.y(i) ** 2) / 2e8)
  );
  const output = smoothMetric(map, input, 15_000);
  expect(integral(map, output)).toBeCloseTo(integral(map, input), -2);
  expect(maximum(map, output)).toBeLessThan(maximum(map, input));
  const flat = workingValues(map, "float64", "test:flat", () => 7);
  const constant = smoothMetric(map, flat, 15_000);
  expect(countWhere(map, constant, (v) => Math.abs(v - 7) >= 1e-9)).toBe(0);
  releaseWorking(map, input, output, flat, constant);
});

it("solves the fine physical equation at high coarse/fine contrast and long influence length", () => {
  const topology = createAdaptiveTopology(bounds, {
    maximumSize: 12_500,
    minimumSize: 390.625,
    refine: ([x, y, right, top]) => x < 1500 && right > -1500 && y < 10_000 && top > -10_000,
  });
  const mesh = adaptivePhysicalMesh(topology, rectangle(bounds)),
    map = createField(mesh);
  const input = workingValues(
    map,
    "float64",
    "test:input",
    (i) => Math.sin(mesh.x(i) / 9000) + Math.cos(mesh.y(i) / 7000)
  );
  const result = smoothMetric(map, input, 200_000);
  const matrix = metricOperator(map, 200_000),
    applied = metricArray(map, "applied", matrix.count);
  metricProduct(matrix, result, applied);
  let residual = 0,
    magnitude = 0;
  for (let i = 0; i < result.length; i++) {
    const rhs = input.get(i) * mesh.area(i);
    residual += (applied.get(i) - rhs) ** 2 / matrix.diagonal.get(i);
    magnitude += rhs ** 2 / matrix.diagonal.get(i);
  }
  expect(residual / magnitude).toBeLessThan(1e-12);
});

it("remeshes evolved material and provenance without restoring an initial event", () => {
  const map = fixture();
  assign(map, map.BedrockElevation, (i) => map.mesh.x(i) / 10);
  map.SedimentThickness.fill(100);
  assign(map, map.CrustAssemblyIds, (i) => (map.mesh.x(i) < 0 ? 3 : 8));
  map.CumulativeFluvialErosion.fill(400);
  const refined = refineAdaptiveTopology(map.mesh.topology!, [0], 1000);
  const next = remeshPhysical(map, refined, rectangle(bounds));
  expect(integral(next, next.SedimentThickness)).toBeCloseTo(
    integral(map, map.SedimentThickness),
    -2
  );
  expect(integral(next, next.BedrockElevation)).toBeCloseTo(
    integral(map, map.BedrockElevation),
    -2
  );
  expect(new Set(Array.from(next.CrustAssemblyIds))).toEqual(new Set([3, 8]));
  expect(countWhere(next, next.CumulativeFluvialErosion, (v) => v !== 400)).toBe(0);
  expect(countWhere(next, next.FlowTargets, (v) => v !== -1)).toBe(0);
  expect(
    next.coverage.reduce(
      next.Elevation,
      (wrong, v, i) =>
        v === next.BedrockElevation.get(i) + next.SedimentThickness.get(i) ? wrong : wrong + 1,
      0
    )
  ).toBe(0);
});

it("moves hillslope material conservatively across unequal control volumes", () => {
  const map = hillsideFixture();
  assign(map, map.BedrockElevation, (i) => 1024 * (3500 - Math.abs(map.mesh.x(i)) * 2));
  map.Elevation.copyFrom(map.BedrockElevation);
  map.RockResistance.fill(1000);
  const before = integral(map, map.Elevation);
  const profile = atlasPhysicalProfile();
  profile.MassWastingIterations = 1;
  massWasting(map, physicalContext(1, 0, profile));
  expect(integral(map, map.Elevation)).toBeCloseTo(before, -4);
  expect(map.SedimentProducedTotal).toBeGreaterThan(0);
});

it("preserves a gentle mountain flank while relaxing genuinely unstable rock", () => {
  for (const slope of [0.15, 2]) {
    const map = hillsideFixture();
    map.RockResistance.fill(1000);
    assign(map, map.Elevation, (i) => slope * map.mesh.x(i) * 1024);
    map.BedrockElevation.copyFrom(map.Elevation);
    const before = Array.from(map.Elevation),
      volume = integral(map, map.Elevation);
    massWasting(map, physicalContext(42, 0, atlasPhysicalProfile()));
    if (slope === 0.15) expect(Array.from(map.Elevation)).toEqual(before);
    else expect(before.some((value, i) => value !== map.Elevation.get(i))).toBe(true);
    expect(integral(map, map.Elevation)).toBeCloseTo(volume, -2);
  }
});

it("retains lake inventory and a single hydrostatic level when its floor is refined", () => {
  const map = fixture();
  assign(map, map.BedrockElevation, (i) => map.mesh.x(i) / 10);
  map.Elevation.copyFrom(map.BedrockElevation);
  map.WaterKindCodes.fill(2);
  map.WaterBodyIds.fill(17);
  map.WaterSurfaceElevations.fill(10_000);
  assign(map, map.WaterDepths, (i) => 10_000 - map.Elevation.get(i));
  const before = integral(map, map.WaterDepths);
  const refined = refineAdaptiveTopology(map.mesh.topology!, [0, 1, 2], 1000);
  const next = remeshPhysical(map, refined, rectangle(bounds));
  expect(integral(next, next.WaterDepths)).toBeCloseTo(before, -2);
  expect(new Set(Array.from(next.WaterSurfaceElevations)).size).toBe(1);
  expect(
    next.coverage.reduce(
      next.WaterDepths,
      (wrong, depth, i) =>
        depth === next.WaterSurfaceElevations.get(i) - next.Elevation.get(i) ? wrong : wrong + 1,
      0
    )
  ).toBe(0);
});

it("retains ordered ice maxima when history is refined without another glaciation", () => {
  const map = fixture();
  assign(
    map,
    map.MaximumIceFlux,
    (i) => 10 + Math.abs(Math.sin(map.mesh.x(i) / 1700 + map.mesh.y(i) / 2300)) * 1e6
  );
  assign(map, map.MaximumGroundedIceFlux, (i) =>
    Math.min(map.MaximumIceFlux.get(i), Math.abs(Math.cos(i * 1.71)) * 9e5)
  );
  const topology = refineAdaptiveTopology(
    map.mesh.topology!,
    Array.from({ length: map.mesh.count }, (_, i) => map.mesh.cellToLeaf(i)),
    1000
  );
  const next = remeshPhysical(map, topology, rectangle(bounds));
  for (let i = 0; i < next.mesh.count; i++)
    expect(next.MaximumGroundedIceFlux.get(i)).toBeLessThanOrEqual(next.MaximumIceFlux.get(i));
});

it("advects entire material footprints across coarse/fine faces", () => {
  const map = fixture();
  map.CrustMotionX.fill(1000);
  assign(map, map.SedimentThickness, (i) =>
    Math.abs(map.mesh.x(i)) < 20_000 && Math.abs(map.mesh.y(i)) < 20_000 ? 100 : 0
  );
  const before = integral(map, map.SedimentThickness);
  const plan = buildTransportPlan(map, 2000);
  transportHistory(map, plan);
  expect(integral(map, map.SedimentThickness)).toBeCloseTo(before, -2);
  expect(maximum(map, map.SedimentThickness)).toBeLessThanOrEqual(100 + 1e-9);
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
      if (Math.abs(map.mesh.x(i)) > 12_500) continue;
      map.TectonicBoundaryCodes.set(i, code);
      map.TectonicBoundaryPairIds.set(i, 65538);
      map.TectonicStrain.set(i, 800);
      map.CrustCollisionIntensity.set(i, code === 1 ? 900 : 0);
    }
    orogenicConstruction(map, physicalContext(42, 0, profile));
    expect(countWhere(map, map.OrogenicConstruction, (v) => v > 0)).toBeGreaterThan(0);
    if (code === 1) {
      expect(countWhere(map, map.BedrockElevation, (v) => v > 0)).toBeGreaterThan(0);
      expect(countWhere(map, map.RockResistance, (v) => v > 1000)).toBeGreaterThan(0);
    } else expect(countWhere(map, map.OrogenicConstruction, (v) => v < 0)).toBeGreaterThan(0);
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
    // The default depth and rim scaling for an 8 km crater beside 180 km ones.
    p.ImpactDepthRatio = Math.round(p.ImpactDepthRatio * (8 / 180) ** 0.3);
    p.ImpactRimHeightRatio = Math.round(p.ImpactRimHeightRatio * (8 / 180) ** 0.3);
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
    const before = Array.from(map.Elevation);
    massWasting(map, context);
    expect(Array.from(map.Elevation)).toEqual(before);
    map.CrustMotionX.fill(1000);
    map.CrustMotionY.fill(0);
    p.PlateDriftPerEpoch = 250;
    const event = map.events.find((e) => e.kind != "plume")!;
    const previous = event.x;
    plateAdvection(map, context);
    expect(event.x).toBe(previous + 250);
    const moved = physicalSampler(map.mesh, map.Elevation);
    if (kind === "volcano") expect(moved(event.x, event.y) / 1024).toBeGreaterThan(900);
    else expect(moved(event.x, event.y) / 1024).toBeLessThan(-190);
  }
);
