import { expect, it } from "vitest";
import { canonryMagicPresets, type BlockCache } from "@atlas/domain";
import { blockCacheFixture } from "./blockCacheFixture";
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

function scenario(cache: BlockCache) {
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
      cache
    );
  state.cache = cache;
  state.domain.world.magicSystems = canonryMagicPresets();
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    samples: state.surface.coverage.scratch("int32", "physical:samples", 0),
    grid: state.surface.coverage,
    fixed: [],
    inherited: false,
    sampling: { maximumSize: 25_000, minimumSize: 12_500, featureSamples: 2 },
  };
  map.RockResistance.fill(1000);
  map.FractureConductance.fill(800);
  map.HeatSourceDensity.set(0, 1000);
  map.Moisture.fill(800);
  map.Rainfall.fill(900);
  map.SoilDepth.fill(0.5);
  for (let i = 0; i < map.mesh.count; i++) {
    map.Temperature.set(i, 300 + map.mesh.x(i) * 0.0005);
    map.Elevation.set(i, map.mesh.x(i) * 10);
    map.BedrockElevation.set(i, map.Elevation.get(i));
    map.WaterKindCodes.set(i, map.mesh.x(i) < 0 ? 1 : 0);
    map.WaterDepths.set(i, Math.max(0, -map.Elevation.get(i)));
    map.IceThickness.set(i, map.Temperature.get(i) < 300 ? 400 : 0);
  }
  initializeMagic(state);
  return state;
}
it("carries seven-system magic and ecological feedback through disk eviction and stage cleanup", () => {
  const f = blockCacheFixture(32_768);
  try {
    const state = scenario(f.cache),
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
      map.coverage.releaseProcess();
      for (const field of magic.fields) {
        expect(Array.from(field.intensity).every(Number.isFinite)).toBe(true);
        for (const stock of Object.values(field.stocks))
          expect(Array.from(stock).every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
      }
      expect(Array.from(map.TreeCover).every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(
        true
      );
    }
    expect(Array.from(magic.fields[0].intensity).some((v) => v > 0)).toBe(true);
    const total = (values: typeof map.Elevation) =>
      map.coverage.reduce(values, (sum, v, i) => sum + v * map.mesh.area(i), 0);
    const smooth = smoothMetric(map, map.Elevation, 30_000);
    // Signed elevations cancel in this symmetric fixture; normalize by absolute volume.
    const volume = map.coverage.reduce(
      map.Elevation,
      (sum, v, i) => sum + Math.abs(v) * map.mesh.area(i),
      0
    );
    expect(Math.abs(total(smooth) - total(map.Elevation)) / volume).toBeLessThan(1e-8);
    const moved = hillslopeFlux(map, state.physical!.profile);
    expect(map.coverage.reduce(moved.cuts, (sum, v) => sum + v, 0)).toBeCloseTo(
      map.coverage.reduce(moved.fills, (sum, v) => sum + v, 0),
      2
    );
    expect(f.cache.stats.loads).toBeGreaterThan(0);
    expect(f.cache.stats.peakBytes).toBeLessThanOrEqual(32_768);
  } finally {
    f.close();
  }
});
