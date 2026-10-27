import { closeSync, mkdtempSync, openSync, readSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { canonryMagicPresets, type NumericalVector } from "@atlas/domain";
import { PagedArena } from "./pagedArena";
import { landscape } from "../../generation/src/mapFixtures";
import { createAdaptiveWorldMesh } from "../../generation/src/canonry/adaptiveMesh";
import { createField } from "../../generation/src/canonry/field";
import { atlasPhysicalProfile } from "../../generation/src/canonry/atlasProfile";
import { initializeMagic } from "../../generation/src/canonry/magicState";
import { locateMagicSources } from "../../generation/src/canonry/magicSources";
import { propagateMagic } from "../../generation/src/canonry/magicPropagation";
import {
  magicThermalFeedback,
  magicRockFeedback,
} from "../../generation/src/canonry/magicFeedback";
import { classifyMagicFeatures } from "../../generation/src/canonry/magicFeatures";
import { evolveVegetation } from "../../generation/src/canonry/ecologyVegetation";
import { smoothMetric } from "../../generation/src/canonry/metricSmoothing";
import { hillslopeFlux } from "../../generation/src/canonry/hillslopeFlux";

function scenario(arena: PagedArena) {
  const state = landscape(),
    map = createField(
      createAdaptiveWorldMesh(
        [-100_000, -100_000, 100_000, 100_000],
        {
          maximumSize: 25_000,
          minimumSize: 12_500,
          refine: ([x]) => x < 0,
        },
        0
      ),
      arena
    );
  state.numerical = arena;
  state.domain.world.magicSystems = canonryMagicPresets();
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    samples: new Int32Array(0),
    fixed: [],
    inherited: false,
    sampling: { maximumSize: 25_000, minimumSize: 12_500, featureSamples: 2 },
  };
  map.RockResistance.fill(1000);
  map.FractureConductance.fill(800);
  map.HeatSourceDensity[0] = 1000;
  map.Moisture.fill(800);
  map.Rainfall.fill(900);
  map.SoilDepth.fill(0.5);
  for (let i = 0; i < map.mesh.count; i++) {
    map.Temperature[i] = 300 + map.mesh.x[i] * 0.0005;
    map.Elevation[i] = map.mesh.x[i] * 10;
    map.BedrockElevation[i] = map.Elevation[i];
    map.WaterKindCodes[i] = map.mesh.x[i] < 0 ? 1 : 0;
    map.WaterDepths[i] = Math.max(0, -map.Elevation[i]);
    map.IceThickness[i] = map.Temperature[i] < 300 ? 400 : 0;
  }
  initializeMagic(state);
  return state;
}
it("carries seven-system magic and ecological feedback through disk eviction and stage cleanup", () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-causal-")),
    fd = openSync(join(directory, "work"), "w+");
  const arena = new PagedArena(
    {
      read: (bytes, at) => readSync(fd, bytes, 0, bytes.byteLength, at),
      write: (bytes, at) => writeSync(fd, bytes, 0, bytes.byteLength, at),
      flush() {},
      close: () => closeSync(fd),
    },
    32_768,
    128
  );
  try {
    const state = scenario(arena),
      map = state.physical!.map,
      magic = state.physical!.magic!;
    expect(magic.fields).toHaveLength(7);
    for (let epoch = 0; epoch < 2; epoch++) {
      for (const field of magic.fields) {
        locateMagicSources(state, field, 42);
        propagateMagic(state, field, 42, 1);
      }
      magicThermalFeedback(state);
      magicRockFeedback(state);
      evolveVegetation(map, 100);
      classifyMagicFeatures(state, 42);
      arena.releaseProcess();
      for (const field of magic.fields) {
        expect(field.intensity.every(Number.isFinite)).toBe(true);
        for (const stock of Object.values(field.stocks))
          expect(stock.every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
      }
      expect(map.TreeCover.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
    }
    expect(magic.fields[0].intensity.some((v) => v > 0)).toBe(true);
    const total = (values: NumericalVector) =>
      values.reduce((sum, v, i) => sum + v * map.mesh.areas[i], 0);
    const smooth = smoothMetric(map.mesh, map.Elevation, 30_000, undefined, arena);
    // Signed elevations cancel in this symmetric fixture; normalize by absolute volume.
    const volume = map.Elevation.reduce((sum, v, i) => sum + Math.abs(v) * map.mesh.areas[i], 0);
    expect(Math.abs(total(smooth) - total(map.Elevation)) / volume).toBeLessThan(1e-8);
    const moved = hillslopeFlux(map, state.physical!.profile);
    expect(moved.cuts.reduce((sum, v) => sum + v, 0)).toBeCloseTo(
      moved.fills.reduce((sum, v) => sum + v, 0),
      2
    );
    expect(arena.stats.reads).toBeGreaterThan(0);
    expect(arena.stats.peakDecodedBytes).toBeLessThanOrEqual(32_768);
  } finally {
    arena.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
