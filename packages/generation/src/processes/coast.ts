// CoastalErosionLayer.cs, Canonry 0f62584c.
import { clamp, units } from "../world/math";
import { compileMix } from "../rock/modes";
import { defineProcess } from "./groundProcess";
import { coastSettings } from "./coastSettings";

/** Waves grind with what they throw, and pull blocks out along joints. */
const pounding = compileMix({ abrasion: 0.6, plucking: 0.4 });
export const coast = defineProcess({
  id: "coast",
  statement:
    "Waves wear the land they reach back by their energy and what the rock gives up, down to a platform below the sea, so coasts retreat and rock decides where headlands stand.",
  reads: ["WaterKindCodes", "WaveExposure", "Slope", "Elevation"],
  writes: ["WaveExposureHistory"],
  asks: [],
  moves: [
    ["rock", "load"],
    ["loose", "load"],
  ],
  settings: coastSettings,
  run({ field, context: c, settings: p, ground, span, tools }) {
    const frame = tools.shoreFrame(p.CoastalActiveWidth),
      loads = tools.scratch("coast:loads");
    for (let i = 0; i < field.mesh.count; i++) {
      const wave = frame.strength.get(i),
        water = field.WaterKindCodes.get(i),
        coverage = frame.coverage.get(i);
      if (water === 1)
        field.WaveExposureHistory.set(
          i,
          Math.max(field.WaveExposureHistory.get(i), field.WaveExposure.get(i))
        );
      else if (coverage > 0)
        field.WaveExposureHistory.set(i, Math.max(field.WaveExposureHistory.get(i), wave));
      if (wave < p.CoastalErosionWaveThreshold || water !== 0) continue;
      const steep = clamp(field.Slope.get(i) * 10_000, 0, 1000),
        energy = ((wave - p.CoastalErosionWaveThreshold) * p.CoastalErosionStrength) / 1000,
        forcing = energy + steep / 18 + Math.abs(p.CoastalSeaLevelChange),
        power = (forcing * p.CoastalWearRate * span * c.CoastalStrength * coverage) / 1000,
        platform =
          field.Elevation.get(i) - (field.EffectiveSeaLevel - units(p.CoastalPlatformDepth)),
        cut = ground.actOn(i, pounding, power, Math.max(0, platform));
      if (cut > 0) loads.add(frame.source.get(i), tools.coastCut(i, cut));
    }
    tools.depositShoreLoads(c, frame, loads, false);
    tools.release(loads, frame.strength, frame.coverage, frame.source);
  },
});
export const outsideWaves = defineProcess({
  id: "outside-waves",
  statement:
    "Waves a magic system raises wear the shore they reach as any waves do, and what they take goes out to sea.",
  reads: ["WaterKindCodes", "Elevation"],
  writes: ["ExternalCoastalForcing", "ExternalCoastalForcingHistory"],
  asks: [],
  moves: [
    ["rock", "load"],
    ["loose", "load"],
  ],
  settings: coastSettings,
  run({ field, context: c, settings: p, ground, span, tools }) {
    for (let i = 0; i < field.mesh.count; i++) {
      const forcing = field.ExternalCoastalForcing.get(i);
      if (forcing > 1000 || (forcing > 0 && field.WaterKindCodes.get(i) !== 0))
        throw new Error("External coastal forcing must target dry terrain.");
    }
    const frame = tools.shoreFrame(p.CoastalActiveWidth, field.ExternalCoastalForcing),
      loads = tools.scratch("coast:loads");
    for (let i = 0; i < field.mesh.count; i++) {
      const forcing = frame.strength.get(i),
        coverage = frame.coverage.get(i);
      if (forcing <= 0 || coverage <= 0) continue;
      field.ExternalCoastalForcingHistory.set(
        i,
        Math.max(field.ExternalCoastalForcingHistory.get(i), forcing)
      );
      const power = (forcing * p.CoastalWearRate * span * c.CoastalStrength * coverage) / 1000,
        platform =
          field.Elevation.get(i) - (field.EffectiveSeaLevel - units(p.CoastalPlatformDepth)),
        cut = ground.actOn(i, pounding, power, Math.max(0, platform));
      if (cut > 0) loads.add(frame.source.get(i), tools.coastCut(i, cut));
    }
    tools.depositShoreLoads(c, frame, loads, true);
    tools.release(loads, frame.strength, frame.coverage, frame.source);
    field.ExternalCoastalForcing.fill(0);
  },
});
