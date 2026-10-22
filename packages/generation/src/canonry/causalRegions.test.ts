import { expect, it } from "vitest";
import {
  createAdaptiveField,
  createAdaptiveTopology,
  magicSystemSchema,
  rectangle,
  spatial,
  fieldInterpolator,
  fieldCategories,
  type MagicFeatureRule,
} from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { createField } from "./field";
import { adaptivePhysicalMesh } from "./adaptiveMesh";
import { atlasPhysicalProfile } from "./atlasProfile";
import { initializeMagic } from "./magicState";
import { prepareMagicFields } from "./magicContinuous";
import { classifyMagicFeatures, projectMagic } from "./magicFeatures";
import { refreshWorkspaceSamples } from "./atlasWorkspace";
import { projectNative } from "./atlasProjection";
import { extractMagicPlaces } from "./geographicRegions";
import { oceanFootprint } from "./geographicContours";
import { preparePhysicalChannels } from "./continuousState";
import { advectMagicOccurrences } from "./magicOccurrences";
import {
  above,
  all,
  any,
  below,
  not,
  regionShape,
  physicalScalar,
  regionTracer,
  type CausalScalar,
} from "./causalRegions";

it("traces later inequalities inside their Boolean scope without poisoning global caches", () => {
  const { state } = fixture({
    id: "none",
    name: "None",
    priority: 1,
    seeds: [[{ field: "intensity", min: 1000 }]],
  });
  const topology = createAdaptiveTopology([0, 0, 500, 500], { maximumSize: 50, minimumSize: 50 });
  state.physical!.map = createField(adaptivePhysicalMesh(topology, state.domain.scope.footprint));
  let furthest = 0;
  const scalar: CausalScalar = (x) => {
    furthest = Math.max(furthest, x);
    return x;
  };
  scalar.enclose = (box) => ({
    range: [box[0], box[2]],
    gradient: [
      [1, 1],
      [0, 0],
    ],
  });
  scalar.segment = (a, b) => ({
    range: [Math.min(a[0], b[0]), Math.max(a[0], b[0])],
    derivative: [b[0] - a[0], b[0] - a[0]],
  });
  const trace = regionTracer(state),
    small = regionShape(rectangle([25, 25, 75, 75])),
    right = above(scalar, 50);
  expect(spatial.area(trace(all(small, right))!)).toBeCloseTo(1250, 3);
  expect(furthest).toBeLessThan(125);
  expect(spatial.area(trace(all(small, not(right)))!)).toBeCloseTo(1250, 3);
  expect(spatial.area(trace(all(small, any(right, not(right))))!)).toBeCloseTo(2500, 3);
  expect(spatial.area(trace(right)!)).toBeCloseTo(225000, 3);
  // A global cache entry is clipped when the same predicate is later scoped.
  expect(spatial.area(trace(all(small, right))!)).toBeCloseTo(1250, 3);
});

it("does not infer nonnegative geography from a positive-support evaluator", () => {
  const { state, map } = fixture({
    id: "none",
    name: "None",
    priority: 1,
    seeds: [[{ field: "intensity", min: 1000 }]],
  });
  for (let i = 0; i < map.mesh.count; i++) map.Elevation[i] = map.mesh.x[i];
  preparePhysicalChannels(map, ["Elevation"]);
  const scalar = physicalScalar(state, "Elevation"),
    trace = regionTracer(state);
  expect(scalar.positiveSupport?.()).not.toBeNull();
  for (const [region, greater] of [
    [above(scalar, 0), true],
    [below(scalar, 0, false), false],
  ] as const) {
    const shape = trace(region)!;
    expect(spatial.area(shape)).toBeCloseTo(125000, 1);
    const covers = spatial.pointCoverage(shape);
    expect(covers({ x: 100, y: 250, z: 0 })).toBe(!greater);
    expect(covers({ x: 400, y: 250, z: 0 })).toBe(greater);
  }
});

function fixture(rule: MagicFeatureRule) {
  const state = landscape(),
    bounds = [0, 0, 500, 500] as const;
  state.domain.world.id = "00000000-0000-4000-8000-000000000001";
  state.domain.scope.footprint = rectangle([...bounds]);
  const topology = createAdaptiveTopology([...bounds], { maximumSize: 250, minimumSize: 250 });
  state.surface = createAdaptiveField("field", state.domain.scope, topology);
  const map = createField(adaptivePhysicalMesh(topology, state.domain.scope.footprint));
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    samples: map.mesh.leafToCell,
    fixed: [],
    inherited: false,
    sampling: { maximumSize: 250, minimumSize: 250, featureSamples: 2 },
  };
  initializeMagic(state, true, [
    magicSystemSchema.parse({
      id: "test",
      name: "Test",
      source: "placed",
      propagation: "radial",
      phase: "climate",
      features: [rule],
    }),
  ]);
  const field = state.physical.magic!.fields[0];
  for (let i = 0; i < map.mesh.count; i++) {
    field.intensity[i] = map.mesh.x[i] + map.mesh.origin[0];
    map.Temperature[i] = map.mesh.y[i] + map.mesh.origin[1];
    map.Elevation[i] = 1024;
  }
  return { state, map, field };
}
function extract(state: ReturnType<typeof landscape>) {
  prepareMagicFields(state, "climate");
  refreshWorkspaceSamples(state, state.physical!);
  projectNative(state);
  classifyMagicFeatures(state, 17);
  projectMagic(state);
  extractMagicPlaces(state);
  return Object.values(state.domain.world.features).filter(
    (feature) => feature.layerId === "magic"
  );
}
const band = (left: number, right: number) => [
  { field: "intensity", min: left, max: right },
  { field: "temperature", min: 200, max: 210 },
];
it("publishes a ten-metre magic band between samples, including a seed that fails retention", () => {
  const { state, field } = fixture({
    id: "band",
    name: "Band",
    priority: 1,
    seeds: [band(200, 210)],
    retains: [band(300, 310)],
  });
  const features = extract(state);
  expect(field.features.band.some(Boolean)).toBe(false);
  expect(features).toHaveLength(1);
  // The tracer's 0.1 m root tolerance bounds the area error of this 10 m square.
  expect(Math.abs(spatial.area(features[0].geometry) - 100)).toBeLessThan(4.04);
  expect(spatial.pointCoverage(features[0].geometry)({ x: 205, y: 205, z: 0 })).toBe(true);
  expect(spatial.pointCoverage(features[0].geometry)({ x: 305, y: 205, z: 0 })).toBe(false);
  const delivered = structuredClone(state.surface),
    p = { x: 205, y: 205, z: 0 };
  expect(fieldInterpolator(delivered, "magic:test:feature:band", true)(p)).toBe(1);
  expect(fieldInterpolator(delivered, "finalSurface", true)(p)).toBe(100);
  expect(fieldCategories(delivered, "finalSurface")).toContain(100);
  expect(fieldInterpolator(delivered, "magic:test:feature:band", true)({ ...p, x: 305 })).toBe(0);
});
it("retains a constant field exactly at an inclusive configured threshold", () => {
  const { state, field } = fixture({
    id: "plateau",
    name: "Plateau",
    priority: 1,
    seeds: [[{ field: "intensity", min: 470 }]],
  });
  field.intensity.fill(470);
  const features = extract(state);
  expect(features).toHaveLength(1);
  expect(spatial.area(features[0].geometry)).toBeCloseTo(250000, 3);
});
it("keeps a sub-sample first-arrival region authoritative for magic conditions", () => {
  const { state, field } = fixture({
    id: "history",
    name: "History",
    priority: 1,
    seeds: [[{ field: "firstEpoch", values: [2] }]],
  });
  field.firstEpoch.fill(9);
  field.occurrences = { firstEpoch: [{ epoch: 2, footprint: rectangle([200, 200, 210, 210]) }] };
  const features = extract(state);
  expect(field.features.history.some(Boolean)).toBe(false);
  expect(features).toHaveLength(1);
  expect(spatial.area(features[0].geometry)).toBeCloseTo(100, 3);
});
it("does not turn an enclosed below-sea basin into ocean", () => {
  const { state, map } = fixture({
    id: "none",
    name: "None",
    priority: 1,
    seeds: [[{ field: "intensity", min: 1000 }]],
  });
  for (let i = 0; i < map.mesh.count; i++)
    map.Elevation[i] = map.mesh.x[i] ** 2 + map.mesh.y[i] ** 2 - 200 ** 2;
  map.WaterKindCodes.fill(0);
  preparePhysicalChannels(map, []);
  expect(oceanFootprint(state)).toBeNull();
});
it("clips transported occurrence geography to adaptive support across repeated advection", () => {
  const { state, map, field } = fixture({
    id: "none",
    name: "None",
    priority: 1,
    seeds: [[{ field: "intensity", min: 1000 }]],
  });
  field.occurrences = { firstEpoch: [{ epoch: 2, footprint: rectangle([400, 100, 490, 200]) }] };
  map.CrustMotionX.fill(1000);
  map.CrustMotionY.fill(0);
  map.LastPlateDriftStep = 60;
  map.provinces = {
    origin: [...map.mesh.origin],
    seed: 1,
    scale: 1000,
    strength: 0,
    sites: [{ x: 0, y: 0, priority: 0, assembly: 1, motionX: 1, motionY: 0 }],
  };
  preparePhysicalChannels(map, []);
  advectMagicOccurrences(state, field);
  const first = field.occurrences.firstEpoch![0].footprint;
  expect(spatial.bounds(first)).toEqual([460, 100, 500, 200]);
  advectMagicOccurrences(state, field);
  expect(field.occurrences.firstEpoch).toEqual([]);
});
