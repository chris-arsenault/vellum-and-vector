import { expect, it } from "vitest";
import { executeProcessBehavior } from "./processTraits";
import {
  createGrid,
  gridPosition,
  putChannel,
  rectangle,
  resolveParameters,
  type DomainSnapshot,
  type SpatialScope,
  type World,
} from "@atlas/domain";
import { drainageProcess, erosionProcess } from "./mapHydrology";
import { initializeTerrainProcess, tectonicsProcess } from "./mapTerrain";
import { randomStream } from "./random";
import { secondsPerYear } from "./mapLattice";
import type { GenerationCause, GenerationState, MapProcess, MapProcessContext } from "./process";

const worldId = "00112233-4455-6677-8899-aabbccddeeff";
const areaId = "10112233-4455-6677-8899-aabbccddeeff";
function state(width = 9, height = width): GenerationState {
  const footprint = rectangle([0, 0, 800, 800]);
  const scope: SpatialScope = {
    worldId,
    areaId,
    spaceId: worldId,
    footprint,
    crsId: "VELLUM:test",
    revision: 1,
    time: "present",
    resolution: null,
  };
  const world: World = {
    id: worldId,
    owner: "owner",
    name: "Atlas",
    seed: 7,
    version: 1,
    reference: {
      id: scope.crsId,
      domain: footprint,
      topology: "planar",
      units: "metre",
      axes: "east,north,up",
      verticalDatum: "sea",
    },
    areas: {
      [areaId]: {
        id: areaId,
        name: "Root",
        parentId: null,
        profile: "world",
        footprint,
        frame: { origin: { x: 0, y: 0, z: 0 }, rotation: 0, metresPerUnit: 1, floor: null },
        context: "landscape",
        version: 1,
        traits: [],
        layers: {},
        boundary: null,
        templateId: null,
      },
    },
    features: {},
    layers: {},
    fields: [],
    entities: {},
    templates: {},
    magic: [],
    epochs: [],
    generations: [],
    views: [],
  };
  const domain: DomainSnapshot = {
    world,
    scope,
    revisions: [],
    resources: [],
    numerical: {},
    identities: {},
    coverage: [],
    fieldPatches: [],
  };
  return {
    domain,
    surface: createGrid("surface", scope, width, height),
    facts: new Set(),
    history: [],
    causes: [],
  };
}
function context(
  process: MapProcess,
  overrides: Record<string, number | boolean> = {},
  years = 1
): MapProcessContext {
  const random = randomStream("geography-fixture", "world", process.contract.id, "test", []);
  return {
    scope: state(2).domain.scope,
    invocation: [process.contract.id],
    parameters: resolveParameters(process.contract.parameters, overrides),
    epochs: [{ id: "epoch", duration: years, parentEpoch: null, variables: {} }],
    epochIndices: [0],
    causes: [],
    recordCause() {},
    random: () => random.next(),
    cancelled: () => false,
    progress() {},
  };
}
function apply(
  process: MapProcess,
  target: GenerationState,
  parameters: Record<string, number | boolean> = {},
  years = 1
) {
  const ctx = context(process, parameters, years);
  ctx.recordCause = (cause) => target.causes!.push(cause);
  executeProcessBehavior(process, target, ctx);
  process.validate(target, ctx);
  for (const fact of process.contract.invalidates) target.facts.delete(fact);
  for (const fact of process.contract.produces) target.facts.add(fact);
}
function suppliedSurface(target: GenerationState, heights: (i: number) => number) {
  putChannel(
    target.surface,
    "elevation",
    "metre",
    Float64Array.from(target.surface.active, (_, i) => heights(i))
  );
  apply(initializeTerrainProcess, target);
  putChannel(
    target.surface,
    "rainfall",
    "metre/year",
    new Float64Array(target.surface.active.length).fill(1)
  );
  target.facts.add("rainfall");
}
function materialVolume(target: GenerationState) {
  return target.surface.channels.elevation.reduce(
    (sum, z, i) => sum + z * target.surface.measures[i],
    0
  );
}

it("initializes deterministic provinces, material and spatially correlated terrain", () => {
  const first = state(25),
    second = state(25);
  apply(initializeTerrainProcess, first);
  apply(initializeTerrainProcess, second);
  expect(first.surface.channels).toEqual(second.surface.channels);
  const z = first.surface.channels.elevation;
  expect(Math.max(...z) - Math.min(...z)).toBeGreaterThan(1000);
  const near =
    z.slice(0, -1).reduce((sum, v, i) => sum + Math.abs(v - z[i + 1]), 0) / (z.length - 1);
  const far =
    z.slice(0, -100).reduce((sum, v, i) => sum + Math.abs(v - z[i + 100]), 0) / (z.length - 100);
  expect(near).toBeLessThan(far);
  expect(new Set(first.surface.channels.province).size).toBeGreaterThan(2);
  expect(
    Object.values(first.domain.world.entities).every((e) => e.kind === "geologicalProvince")
  ).toBe(true);
});

it("keeps inherited elevation and accumulates tectonic uplift over elapsed epochs", () => {
  const first = state(),
    second = state();
  suppliedSurface(first, (i) => 100 + i);
  suppliedSurface(second, (i) => 100 + i);
  expect(first.surface.channels.elevation[40]).toBe(140);
  apply(tectonicsProcess, first, { advection: false }, 1000);
  apply(tectonicsProcess, first, { advection: false }, 1000);
  apply(tectonicsProcess, second, { advection: false }, 2000);
  first.surface.channels.elevation.forEach((z, i) =>
    expect(z).toBeCloseTo(second.surface.channels.elevation[i], 10)
  );
  expect(first.surface.channels.elevation.some((z, i) => Math.abs(z - (100 + i)) > 0.01)).toBe(
    true
  );
});

it("conditions an inland depression into an acyclic spill path without cutting its floor", () => {
  const target = state(7);
  suppliedSurface(target, (i) => (i === 24 ? -8 : i === 3 ? 1 : 10));
  const original = target.surface.channels.elevation.slice();
  apply(drainageProcess, target, { seaLevel: -100, evaporation: 0, runoffFraction: 1 });
  expect(target.surface.channels.elevation).toEqual(original);
  expect(target.surface.channels.depressionDepth[24]).toBe(18);
  expect(target.surface.channels.water[24]).toBe(2);
  const runoff = target.surface.channels.runoff.reduce(
    (sum, v, i) => sum + (v * target.surface.measures[i]) / secondsPerYear,
    0
  );
  const exported = target.surface.channels.outletFlow.reduce((sum, v) => sum + v, 0);
  expect(exported).toBeCloseTo(runoff, 12);
  expect(target.causes?.at(-1)).toMatchObject({ kind: "drainage", runoff, outflow: exported });
});

it("keeps dry closed depressions distinct from ocean and excludes inactive cells", () => {
  const target = state(7);
  suppliedSurface(target, (i) => (i === 24 ? -8 : 10));
  target.surface.active[16] = 0;
  target.surface.channels.rainfall.fill(0);
  apply(drainageProcess, target, { evaporation: 0 });
  expect(target.surface.channels.depressionDepth[24]).toBe(18);
  expect(target.surface.channels.water[24]).toBe(0);
  expect(target.surface.channels.flow[16]).toBe(0);
  expect(Array.from(target.surface.channels.receiver)).not.toContain(16);
});

it("routes fresh meltwater as a rate over its actual elapsed years", () => {
  const target = state(5);
  suppliedSurface(target, (i) => 100 + i);
  target.surface.channels.rainfall.fill(0);
  putChannel(target.surface, "meltwater", "metre", new Float64Array(25).fill(20));
  target.facts.add("meltwater");
  apply(drainageProcess, target, { evaporation: 0, runoffFraction: 1 }, 10);
  expect(target.surface.channels.runoff[12]).toBe(2);
  expect(target.surface.channels.outletFlow.reduce((sum, v) => sum + v, 0)).toBeCloseTo(
    (800 * 800 * 2) / secondsPerYear,
    12
  );
});

it("conserves eroded material through deposition/export and preserves an authored patch", () => {
  const target = state(9);
  suppliedSurface(target, (i) => 1000 - gridPosition(target.surface, i).x);
  const protectedIndex = 40,
    center = gridPosition(target.surface, protectedIndex);
  target.domain.fieldPatches.push({
    id: "patch",
    fieldId: "field",
    areaId,
    spaceId: worldId,
    footprint: rectangle([center.x - 1, center.y - 1, center.x + 1, center.y + 1]),
    channels: ["elevation"],
    actor: "user",
    resourceId: "samples",
    protected: true,
    createdVersion: 1,
  });
  const protectedHeight = target.surface.channels.elevation[protectedIndex];
  apply(drainageProcess, target, { evaporation: 0, runoffFraction: 1 });
  const before = materialVolume(target);
  apply(erosionProcess, target, { transportConcentration: 0 }, 10000);
  const cause = target.causes?.at(-1) as Extract<GenerationCause, { kind: "material" }>;
  expect(cause.eroded).toBeGreaterThan(0);
  expect(cause.eroded).toBeCloseTo(cause.deposited + cause.exported, 6);
  expect(materialVolume(target) - before).toBeCloseTo(-cause.exported, 5);
  expect(target.surface.channels.elevation[protectedIndex]).toBe(protectedHeight);
  expect(target.facts.has("flow")).toBe(false);
  target.surface.channels.elevation.forEach((z, i) =>
    expect(z).toBeCloseTo(
      target.surface.channels.bedrock[i] + target.surface.channels.sediment[i],
      10
    )
  );
});

it("reports cancellation before starting a long terrain pass", () => {
  const target = state(),
    ctx = context(initializeTerrainProcess);
  ctx.cancelled = () => true;
  expect(() => executeProcessBehavior(initializeTerrainProcess, target, ctx)).toThrow("cancelled");
});
