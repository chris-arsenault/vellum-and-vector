import { expect, it } from "vitest";
import {
  createAdaptiveField,
  createAdaptiveTopology,
  createGrid,
  createIntentRegistry,
  FactDependencies,
  fieldInterpolator,
  gridPosition,
  projectChanges,
  putChannel,
  rectangle,
  spatial,
} from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { adaptivePhysicalMesh } from "./adaptiveMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { preparePhysicalChannels } from "./continuousState";
import {
  refreshWorkspaceProtection,
  composeNativeAuthoring,
  refreshWorkspaceSamples,
} from "./atlasWorkspace";
import { plateAdvection } from "./advection";
import { physicalContext } from "./context";
import { projectNative } from "./atlasProjection";
import { composeAuthoredSamples, validateAuthoredInputs } from "../mapAuthored";
import { prepareMotionPieces } from "./motionPieces";
import { affinePoint } from "./materialAffine";

function sculptedFixture() {
  const state = landscape(),
    id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const footprint = rectangle([0, 0, 100, 100]),
    area = state.domain.world.areas.area;
  state.domain.world.id = id(1);
  state.domain.world.reference.domain = footprint;
  state.domain.scope = {
    ...state.domain.scope,
    worldId: id(1),
    areaId: id(2),
    spaceId: id(3),
    footprint,
  };
  state.domain.world.areas = { [id(2)]: { ...area, id: id(2), spaceId: id(3), footprint } };
  const base = createGrid(id(4), state.domain.scope, 3, 3);
  putChannel(base, "crustMotionX", "ratio", new Float64Array(9));
  putChannel(base, "crustMotionY", "ratio", new Float64Array(9).fill(0.1));
  state.domain.numerical[base.id] = base;
  state.domain.world.fields = [
    {
      id: base.id,
      areaId: id(2),
      layerId: "physical",
      algorithm: "tectonics",
      source: { kind: "run", id: "previous" },
      samples: 9,
      channels: ["crustMotionX", "crustMotionY"],
      state: "generated",
    },
  ];
  const context = {
    owner: "creator",
    actor: "creator",
    operationId: id(5),
    scope: state.domain.scope,
    layers: Object.values(state.domain.world.layers),
    fields: state.domain.world.fields,
    facts: new FactDependencies(),
  };
  const changes = createIntentRegistry()
    .bind(
      {
        operationId: id(5),
        expectedVersion: 1,
        version: 1,
        kind: "sculptField",
        scope: state.domain.scope,
        data: {
          fieldId: base.id,
          channel: "crustMotionX",
          center: { x: 20, y: 20, z: 0 },
          radius: 4,
          amount: 0.9,
          mode: "set",
          falloff: "smooth",
        },
      },
      context
    )
    .evaluate(state.domain);
  state.domain = projectChanges(state.domain, changes);
  state.domain.scope = { ...state.domain.scope, revision: state.domain.world.version };
  return { state, base };
}
function motionWorkspace(state: ReturnType<typeof landscape>) {
  const topology = createAdaptiveTopology([0, 0, 100, 100], { maximumSize: 50, minimumSize: 50 });
  state.surface = createAdaptiveField("working", state.domain.scope, topology);
  const map = createField(adaptivePhysicalMesh(topology, state.domain.scope.footprint));
  map.provinces = {
    origin: [...map.mesh.origin],
    seed: 1,
    scale: 100,
    strength: 0,
    sites: [{ x: 0, y: 0, priority: 0, assembly: 1, motionX: 0, motionY: 0.1 }],
  };
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    samples: map.mesh.leafToCell,
    fixed: [],
    inherited: false,
    sampling: { maximumSize: 50, minimumSize: 50, featureSamples: 2 },
  };
  preparePhysicalChannels(map, []);
  refreshWorkspaceSamples(state, state.physical);
  refreshWorkspaceProtection(state, state.physical);
  composeNativeAuthoring(state.physical);
  return state.physical;
}
it("carries a real sculpted patch through workspace motion and publication without a native sample", () => {
  const { state, base } = sculptedFixture(),
    original = structuredClone(state.domain),
    work = motionWorkspace(state),
    map = work.map;
  expect(map.CrustMotionX.every((v) => v === 0)).toBe(true);
  const authored = fieldInterpolator(
    state.domain.numerical[base.id],
    "crustMotionX"
  )({ x: 20, y: 20, z: 0 });
  expect(authored).toBeGreaterThan(0.85);
  map.events = [
    {
      id: "impact",
      kind: "impact",
      x: 20 - map.mesh.origin[0],
      y: 20 - map.mesh.origin[1],
      radius: 1,
      epoch: 0,
      strength: 1000,
    },
  ];
  plateAdvection(map, physicalContext(1, 0, { ...work.profile, PlateDriftPerEpoch: 4 }));
  expect(map.events[0].x + map.mesh.origin[0]).toBeCloseTo(20 + 4 * authored, 2);
  expect(map.events[0].y + map.mesh.origin[1]).toBeCloseTo(20.4, 8);
  preparePhysicalChannels(map, []);
  projectNative(state);
  composeAuthoredSamples(state, original);
  const delivered = structuredClone(state.surface);
  expect(fieldInterpolator(delivered, "crustMotionX")({ x: 20, y: 20, z: 0 })).toBe(authored);
  expect(fieldInterpolator(delivered, "crustMotionY")({ x: 20, y: 20, z: 0 })).toBe(0.1);
  validateAuthoredInputs(state, original);
});

it("resolves curved displacement at the actual epoch distance", () => {
  const bounds: [number, number, number, number] = [0, 0, 100000, 100000],
    footprint = rectangle(bounds),
    map = createField(
      adaptivePhysicalMesh(
        createAdaptiveTopology(bounds, { maximumSize: 100000, minimumSize: 100000 }),
        footprint
      )
    );
  map.provinces = {
    origin: [...map.mesh.origin],
    seed: 1,
    scale: 100000,
    strength: 0,
    sites: [{ x: 0, y: 0, priority: 0, assembly: 1, motionX: 0, motionY: 0 }],
  };
  const patch = createGrid("curved", { ...landscape().domain.scope, footprint }, 3, 3);
  putChannel(
    patch,
    "crustMotionX",
    "ratio",
    Float64Array.from(patch.active, (_, i) => {
      const p = gridPosition(patch, i);
      return (p.x * p.y) / 1e10;
    })
  );
  map.authoredMotion = [{ channel: "crustMotionX", source: patch, footprint }];
  const pieces = prepareMotionPieces(map, 234000),
    at = fieldInterpolator(patch, "crustMotionX");
  for (const p of [
    [6250, 3125],
    [18439, 67231],
    [73892, 16357],
  ] as [number, number][]) {
    const piece = pieces.find((v) => spatial.pointCoverage(v.source)({ x: p[0], y: p[1], z: 0 }))!;
    const moved = affinePoint(piece.forward, p);
    expect(Math.abs(moved[0] - p[0] - 234000 * at({ x: p[0], y: p[1], z: 0 }))).toBeLessThan(10);
  }
});
