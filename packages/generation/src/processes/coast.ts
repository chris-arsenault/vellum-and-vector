// CoastalErosionLayer.cs, Canonry 0f62584c.
import { coastalFrame } from "../canonry/coastalFrame";
import { depositShoreLoads, recordCoastalCut } from "../canonry/coastalEvolution";
import { clamp, units } from "../canonry/math";
import { releaseWorking, workingArray } from "../canonry/physicalNumerics";
import { compileMix } from "../rock/modes";
import { defineProcess } from "./groundProcess";
import { coastSettings } from "./coastSettings";

/** Waves grind with what they throw, and pull blocks out along joints. */
const pounding = compileMix({ abrasion: 0.6, plucking: 0.4 });
export const coast = defineProcess({
  id: "coast",
  statement:
    "Waves wear the land they reach back by their energy and what the rock gives up, down to a platform below the sea, so coasts retreat and rock decides where headlands stand.",
  reads: ["WaterKindCodes", "WaveExposure", "WaveExposureHistory", "Slope", "Elevation"],
  asks: [],
  moves: [
    ["rock", "load"],
    ["loose", "load"],
  ],
  settings: coastSettings,
  run({ field, context: c, settings: p, ground, span, world }) {
    const frame = coastalFrame(world, p.CoastalActiveWidth),
      loads = workingArray(world, "float64", "coast:loads");
    for (let i = 0; i < field.mesh.count; i++) {
      const wave = frame.strength.get(i),
        water = field.WaterKindCodes.get(i),
        coverage = frame.coverage.get(i);
      if (water === 1)
        world.WaveExposureHistory.set(
          i,
          Math.max(field.WaveExposureHistory.get(i), field.WaveExposure.get(i))
        );
      else if (coverage > 0)
        world.WaveExposureHistory.set(i, Math.max(field.WaveExposureHistory.get(i), wave));
      if (wave < p.CoastalErosionWaveThreshold || water !== 0) continue;
      const steep = clamp(field.Slope.get(i) * 10_000, 0, 1000),
        energy = ((wave - p.CoastalErosionWaveThreshold) * p.CoastalErosionStrength) / 1000,
        forcing = energy + steep / 18 + Math.abs(p.CoastalSeaLevelChange),
        power = (forcing * p.CoastalWearRate * span * c.CoastalStrength * coverage) / 1000,
        platform =
          field.Elevation.get(i) - (world.EffectiveSeaLevel - units(p.CoastalPlatformDepth)),
        cut = ground.actOn(i, pounding, power, Math.max(0, platform));
      if (cut > 0) loads.add(frame.source.get(i), recordCoastalCut(world, i, cut));
    }
    depositShoreLoads(world, c, frame, loads, false);
    releaseWorking(world, loads, frame.strength, frame.coverage, frame.source);
  },
});
