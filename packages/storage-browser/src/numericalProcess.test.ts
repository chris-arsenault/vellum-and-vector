import { expect, it } from "vitest";
import {
  createAdaptiveTopology,
  isNumericalVector,
  rectangle,
  putChannel,
  type NumericalVector,
} from "@atlas/domain";
import { adaptivePhysicalMesh } from "../../generation/src/canonry/adaptiveMesh";
import { createField, type PhysicalField } from "../../generation/src/canonry/field";
import { atlasPhysicalProfile } from "../../generation/src/canonry/atlasProfile";
import { physicalContext } from "../../generation/src/canonry/context";
import { initializeLandscape, validateLandscape } from "../../generation/src/canonry/surface";
import { oceanConnectivity } from "../../generation/src/canonry/ocean";
import { bathymetry, oceanDistance } from "../../generation/src/canonry/geography";
import { temperature } from "../../generation/src/canonry/climate";
import { arenaFixture } from "./numericalFixture";
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
import { generationNumericalState } from "../../generation/src/generationNumericalState";

function execute(map: PhysicalField) {
  for (let i = 0; i < map.mesh.count; i++) map.Elevation[i] = map.mesh.x[i] / 10;
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
    const left = map.mesh.x[i] < 0;
    map.CrustContinentalFraction[i] = left ? 1000 : 400;
    map.CrustMotionX[i] = left ? 1000 : -1000;
    map.TectonicBoundaryCodes[i] = 1;
    map.SedimentSupply[i] = 1 + (i % 7);
    map.CumulativeFluvialErosion[i] = i * 10;
    map.MaximumIceThickness[i] = 123;
    map.FeatureFlags[i] = i % 2;
  }
  const plan = buildTransportPlan(map, 70_000);
  transportHistory(map, plan);
  return plan;
}
it("scatters connected crust and history on disk with the same material and provenance", () => {
  const f = arenaFixture();
  try {
    const mesh = createWorldMesh([0, 0, 4e6, 3e6], 256, 0, undefined, undefined, undefined, true),
      native = createField(mesh),
      disk = createField(mesh, f.arena),
      expected = movingCrust(native),
      actual = movingCrust(disk);
    f.arena.releaseProcess();
    for (const key of Object.keys(expected) as (keyof typeof expected)[])
      expect(Array.from(actual[key]), key).toEqual(Array.from(expected[key]));
    for (const [name, values] of Object.entries(native)) {
      if (!isNumericalVector(values)) continue;
      expect(Array.from(disk[name as keyof PhysicalField] as NumericalVector), name).toEqual(
        Array.from(values)
      );
    }
    expect(disk.crustBudget).toEqual(native.crustBudget);
    expect(f.arena.stats.peakDecodedBytes).toBeLessThanOrEqual(32_768);
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
    fixture = arenaFixture();
  try {
    const native = createField(mesh),
      disk = createField(mesh, fixture.arena);
    execute(native);
    execute(disk);
    for (const [name, values] of Object.entries(native)) {
      if (!isNumericalVector(values)) continue;
      const actual = disk[name as keyof PhysicalField];
      expect(isNumericalVector(actual)).toBe(true);
      expect(Array.from(actual as import("@atlas/domain").NumericalVector), name).toEqual(
        Array.from(values)
      );
    }
    expect(disk.EffectiveSeaLevel).toBe(native.EffectiveSeaLevel);
    expect(fixture.arena.stats.reads).toBeGreaterThan(0);
    expect(fixture.arena.stats.peakDecodedBytes).toBeLessThanOrEqual(32_768);
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
  const f = arenaFixture(2048);
  try {
    const box: [number, number, number, number] = [-100000, -50000, 100000, 50000],
      mesh = adaptivePhysicalMesh(
        createAdaptiveTopology(box, {
          maximumSize: 12500,
          minimumSize: 12500,
        }),
        rectangle(box)
      ),
      map = createField(mesh, f.arena);
    for (let i = 0; i < mesh.count; i++) {
      const wet = Math.abs(mesh.x[i]) > 25000 || Math.abs(mesh.y[i]) < 12500;
      map.WaterKindCodes[i] = wet ? 1 : 0;
      map.WaterDepths[i] = wet ? 3000 * 1024 : 0;
    }
    const result = marineRegions(map, 800 * 1024);
    expect(result.regions).toHaveLength(2);
    for (const region of result.regions) {
      expect(region.members.every((i) => result.labels[i] === region.id)).toBe(true);
      expect(region.area).toBeGreaterThan(0);
    }
    const state = landscape();
    state.numerical = f.arena;
    state.domain.world.id = "6ff5503b-19c4-4d95-a407-bf1fc53ac70b";
    putChannel(
      state.surface,
      "elevation",
      "metre",
      new Float64Array(state.surface.active.length).fill(100)
    );
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
    for (const vector of generationNumericalState(state)) vector.retain?.();
    f.arena.releaseProcess();
    expect(work.owner.every((owner) => owner >= 0 && !!work.region.communities[owner])).toBe(true);
    expect(work.region.communities.every((community) => community.areaKm2 > 0)).toBe(true);
    expect(work.river.every(Number.isFinite)).toBe(true);
    expect(f.arena.stats.reads).toBeGreaterThan(0);
  } finally {
    f.close();
  }
});
function lifetimeProcesses(): MapProcess[] {
  let scratch: NumericalVector, failedScratch: NumericalVector;
  return [
    runnerProcess("retained", (state) => {
      scratch = state.numerical!.allocate({
        type: "float64",
        length: 1000,
        lifetime: "process",
        name: "scratch",
      });
      scratch[0] = 7;
      const values = state
        .numerical!.allocate({
          type: "float64",
          length: state.surface.active.length,
          lifetime: "process",
          name: "output",
        })
        .fill(9);
      putChannel(state.surface, "elevation", "metre", values);
    }),
    runnerProcess(
      "discarded",
      (state) => {
        failedScratch = state.numerical!.allocate({
          type: "float64",
          length: 1000,
          lifetime: "process",
          name: "failure",
        });
        failedScratch[0] = 11;
        throw new Error("Deliberate process failure");
      },
      ["retained"]
    ),
    runnerProcess(
      "checked",
      (state) => {
        expect(() => scratch[0]).toThrow(/released/);
        expect(() => failedScratch[0]).toThrow(/released/);
        expect(state.surface.channels.elevation[0]).toBe(9);
      },
      ["retained"]
    ),
    ...replacementProcesses(),
  ];
}
function replacementProcesses() {
  let previous: NumericalVector;
  return [
    runnerProcess(
      "replaced",
      (state) => {
        previous = state.surface.channels.elevation;
        putChannel(
          state.surface,
          "elevation",
          "metre",
          previous.map((value) => value + 1)
        );
      },
      ["checked"]
    ),
    runnerProcess(
      "released",
      (state) => {
        expect(() => previous[0]).toThrow(/released/);
        expect(state.surface.channels.elevation[0]).toBe(10);
      },
      ["replaced"]
    ),
  ];
}
it("carries published disk outputs across runner stages and releases successful and failed scratch", async () => {
  const fixture = arenaFixture(),
    processes = lifetimeProcesses();
  try {
    const registry = new MapProcessRegistry();
    processes.forEach((process) => registry.register(process));
    const result = await new MapRunner(
      configuration(processes.map((process) => invoke(process))),
      registry
    ).runOwned(landscape(), { ...options, numerical: fixture.arena });
    expect(result.state.facts.has("checked")).toBe(true);
    expect(result.state.facts.has("discarded")).toBe(false);
    expect(result.state.facts.has("released")).toBe(true);
    expect(result.state.surface.channels.elevation[0]).toBe(10);
  } finally {
    fixture.close();
  }
});
