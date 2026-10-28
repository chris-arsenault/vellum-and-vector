import { expect, it } from "vitest";
import {
  attachGrid,
  Band,
  createAdaptiveTopology,
  detachGrid,
  everySample,
  generateBand,
  rectangle,
  putChannel,
  type BlockCache,
} from "@atlas/domain";
import { adaptivePhysicalMesh } from "../../generation/src/canonry/adaptiveMesh";
import { createField, type PhysicalField } from "../../generation/src/canonry/field";
import { atlasPhysicalProfile } from "../../generation/src/canonry/atlasProfile";
import { physicalContext } from "../../generation/src/canonry/context";
import { initializeLandscape, validateLandscape } from "../../generation/src/canonry/surface";
import { oceanConnectivity } from "../../generation/src/canonry/ocean";
import { bathymetry, oceanDistance } from "../../generation/src/canonry/geography";
import { temperature } from "../../generation/src/canonry/climate";
import { blockCacheFixture } from "./blockCacheFixture";
import { MapRunner } from "../../generation/src/mapRunner";
import { MapProcessRegistry, type MapProcess } from "../../generation/src/process";
import { landscape, configuration, invoke, options } from "../../generation/src/mapFixtures";
import { drainageConditioning } from "../../generation/src/canonry/drainageFlood";
import { drainageGuidance } from "../../generation/src/canonry/flowGuidance";
import { flowRouting } from "../../generation/src/canonry/routing";
import { riverNetwork } from "../../generation/src/canonry/rivers";
import { createWorldMesh } from "../../generation/src/canonry/worldMesh";
import { buildTransportPlan } from "../../generation/src/canonry/transportPlan";
import { transportHistory } from "../../generation/src/canonry/transportHistory";
import { marineRegions } from "../../generation/src/canonry/marineRegions";
import { createSocietyGeography } from "../../generation/src/societyGeography";
import { numericalProcessLifetime } from "../../generation/src/generationWorkingState";

function execute(map: PhysicalField) {
  for (let i = 0; i < map.mesh.count; i++) map.Elevation.set(i, map.mesh.x(i) / 10);
  initializeLandscape(map);
  const context = physicalContext(42, 0, atlasPhysicalProfile());
  context.Profile.QualityTargets.OceanCoverage.target = 0.5;
  for (const offset of [0, 50]) {
    context.SeaLevelOffset = offset;
    oceanConnectivity(map, context);
    oceanDistance(map);
    drainageConditioning(map, context);
    bathymetry(map, context);
    temperature(map, context);
    map.Runoff.fill(500);
    drainageGuidance(map, context);
    flowRouting(map, context);
    riverNetwork(map, context);
    validateLandscape(map);
  }
}
function movingCrust(map: PhysicalField) {
  map.CrustThickness.fill(4000 * 1024);
  map.RockResistance.fill(1000);
  for (let i = 0; i < map.mesh.count; i++) {
    const left = map.mesh.x(i) < 0;
    map.CrustContinentalFraction.set(i, left ? 1000 : 400);
    map.CrustMotionX.set(i, left ? 1000 : -1000);
    map.TectonicBoundaryCodes.set(i, 1);
    map.SedimentSupply.set(i, 1 + (i % 7));
    map.CumulativeFluvialErosion.set(i, i * 10);
    map.MaximumIceThickness.set(i, 123);
    map.FeatureFlags.set(i, i % 2);
  }
  const plan = buildTransportPlan(map, 70_000);
  transportHistory(map, plan);
  return plan;
}
it("scatters connected crust and history on disk with the same material and provenance", () => {
  const f = blockCacheFixture(32_768);
  try {
    const mesh = createWorldMesh([0, 0, 4e6, 3e6], 256, 0, undefined, undefined, undefined, true),
      native = createField(mesh),
      disk = createField(mesh, f.cache),
      expected = movingCrust(native),
      actual = movingCrust(disk);
    disk.coverage.releaseProcess();
    for (const key of Object.keys(expected) as (keyof typeof expected)[])
      expect(Array.from(actual[key]), key).toEqual(Array.from(expected[key]));
    for (const [name, values] of Object.entries(native)) {
      if (!(values instanceof Band)) continue;
      expect(Array.from(disk[name as keyof PhysicalField] as Band), name).toEqual(
        Array.from(values)
      );
    }
    expect(disk.crustBudget).toEqual(native.crustBudget);
    expect(f.cache.stats.peakBytes).toBeLessThanOrEqual(32_768);
  } finally {
    f.close();
  }
});
it("runs real ocean, distance, bathymetry and climate processes on file-backed physical state", () => {
  const bounds: [number, number, number, number] = [-100_000, -100_000, 100_000, 100_000];
  const topology = createAdaptiveTopology(bounds, {
    maximumSize: 12_500,
    minimumSize: 6250,
    refine: ([x, y]) => x < 0 && y < 0,
  });
  const mesh = adaptivePhysicalMesh(topology, rectangle(bounds)),
    fixture = blockCacheFixture(32_768);
  try {
    const native = createField(mesh),
      disk = createField(mesh, fixture.cache);
    execute(native);
    execute(disk);
    for (const [name, values] of Object.entries(native)) {
      if (!(values instanceof Band)) continue;
      const actual = disk[name as keyof PhysicalField];
      expect(actual instanceof Band).toBe(true);
      expect(Array.from(actual as Band), name).toEqual(Array.from(values));
    }
    expect(disk.EffectiveSeaLevel).toBe(native.EffectiveSeaLevel);
    expect(fixture.cache.stats.loads).toBeGreaterThan(0);
    expect(fixture.cache.stats.peakBytes).toBeLessThanOrEqual(32_768);
  } finally {
    fixture.close();
  }
});
function runnerProcess(
  id: string,
  applyPass: Extract<MapProcess["behavior"], { kind: "model-pass" }>["applyPass"],
  requires: string[] = []
): MapProcess {
  return {
    contract: { id, version: "1", parameters: {}, requires, produces: [id], invalidates: [] },
    behavior: { kind: "model-pass", applyPass },
    validate: () => [],
  };
}
it("keeps marine regions and community ownership valid across paged frontiers and scratch release", () => {
  const f = blockCacheFixture(2048),
    blocks = blockCacheFixture(2048);
  try {
    const box: [number, number, number, number] = [-100000, -50000, 100000, 50000],
      mesh = adaptivePhysicalMesh(
        createAdaptiveTopology(box, {
          maximumSize: 12500,
          minimumSize: 12500,
        }),
        rectangle(box)
      ),
      map = createField(mesh, blocks.cache);
    for (let i = 0; i < mesh.count; i++) {
      const wet = Math.abs(mesh.x(i)) > 25000 || Math.abs(mesh.y(i)) < 12500;
      map.WaterKindCodes.set(i, wet ? 1 : 0);
      map.WaterDepths.set(i, wet ? 3000 * 1024 : 0);
    }
    const result = marineRegions(map, 800 * 1024);
    expect(result.regions).toHaveLength(2);
    for (const region of result.regions) {
      expect(Array.from(region.members).every((i) => result.labels.get(i) === region.id)).toBe(
        true
      );
      expect(region.area).toBeGreaterThan(0);
    }
    const state = onCache(landscape(), f.cache);
    state.domain.world.id = "6ff5503b-19c4-4d95-a407-bf1fc53ac70b";
    putChannel(
      state.surface,
      "elevation",
      "metre",
      generateBand(state.surface.coverage, "float64", "elevation", () => 100)
    );
    const end = numericalProcessLifetime(state);
    const work = createSocietyGeography(state, {
      scope: state.domain.scope,
      invocation: [],
      parameters: {},
      epochs: [],
      epochIndices: [],
      causes: [],
      recordCause() {},
      random: () => 0.5,
      cancelled: () => false,
      progress() {},
    });
    // The process boundary releases the pass's scratch; society's bands stay reachable.
    state.society = work;
    end();
    expect(everySample(work.owner, (owner) => owner >= 0 && !!work.region.communities[owner])).toBe(
      true
    );
    expect(work.region.communities.every((community) => community.areaKm2 > 0)).toBe(true);
    expect(everySample(work.river, Number.isFinite)).toBe(true);
    expect(blocks.cache.stats.loads).toBeGreaterThan(0);
    expect(blocks.cache.stats.evictions).toBeGreaterThan(0);
  } finally {
    f.close();
    blocks.close();
  }
});
function lifetimeProcesses(): MapProcess[] {
  let scratch: Band, failedScratch: Band;
  return [
    runnerProcess("retained", (state) => {
      const coverage = state.surface.coverage;
      scratch = coverage.scratch("float64", "scratch", 1000);
      scratch.set(0, 7);
      const values = coverage.scratch("float64", "output").fill(9);
      putChannel(state.surface, "elevation", "metre", values);
    }),
    runnerProcess(
      "discarded",
      (state) => {
        failedScratch = state.surface.coverage.scratch("float64", "failure", 1000);
        failedScratch.set(0, 11);
        throw new Error("Deliberate process failure");
      },
      ["retained"]
    ),
    runnerProcess(
      "checked",
      (state) => {
        expect(() => scratch.get(0)).toThrow(/released/);
        expect(() => failedScratch.get(0)).toThrow(/released/);
        expect(state.surface.channels.elevation.get(0)).toBe(9);
      },
      ["retained"]
    ),
    ...replacementProcesses(),
  ];
}
function replacementProcesses() {
  let previous: Band;
  return [
    runnerProcess(
      "replaced",
      (state) => {
        previous = state.surface.channels.elevation;
        putChannel(
          state.surface,
          "elevation",
          "metre",
          generateBand(state.surface.coverage, "float64", "next", (i) => previous.get(i) + 1)
        );
      },
      ["checked"]
    ),
    runnerProcess(
      "released",
      (state) => {
        expect(() => previous.get(0)).toThrow(/released/);
        expect(state.surface.channels.elevation.get(0)).toBe(10);
      },
      ["replaced"]
    ),
  ];
}
/** The landscape fixture with its surface grid paging through `cache`. */
function onCache(state: ReturnType<typeof landscape>, cache: BlockCache) {
  state.surface = attachGrid(detachGrid(state.surface), cache) as typeof state.surface;
  state.cache = cache;
  return state;
}
it("carries published evicting outputs across runner stages and releases successful and failed scratch", async () => {
  const fixture = blockCacheFixture(),
    processes = lifetimeProcesses();
  try {
    const registry = new MapProcessRegistry();
    processes.forEach((process) => registry.register(process));
    const result = await new MapRunner(
      configuration(processes.map((process) => invoke(process))),
      registry
    ).runOwned(onCache(landscape(), fixture.cache), { ...options, cache: fixture.cache });
    expect(result.state.facts.has("checked")).toBe(true);
    expect(result.state.facts.has("discarded")).toBe(false);
    expect(result.state.facts.has("released")).toBe(true);
    expect(result.state.surface.channels.elevation.get(0)).toBe(10);
  } finally {
    fixture.close();
  }
});
