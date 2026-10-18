// CoastalErosionLayer.cs and ExternalCoastalForcingLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { PhysicalProfile } from "./profile";
import { clamp, ratio, toUnits, units } from "./math";
import { deposit, erode } from "./surface";

function coastalResistance(map: PhysicalField, p: PhysicalProfile, i: number): number {
  let resistance = map.CrustTypeCodes[i] === 2 ? 18 : 12;
  const volcanic = clamp(
    toUnits(map.VolcanicConstructionHistory[i]) / Math.max(1, p.VolcanicConeHeight),
    0,
    1
  );
  resistance += (volcanic * p.VolcanicRockResistance) / 100;
  const orogenic = clamp(
    map.TectonicActivityHistory[i] / Math.max(1, p.EpochTectonicElevationStep * 2),
    0,
    1
  );
  resistance += (orogenic * p.OrogenicRockResistance) / 100;
  const sediment = clamp(
    toUnits(map.SedimentThickness[i]) / Math.max(1, p.SoftSedimentDepth),
    0,
    1
  );
  return Math.max(4, resistance - (sediment * p.SedimentRockWeakness) / 100);
}
function coastalWaves(map: PhysicalField): Int32Array {
  const waves = new Int32Array(map.mesh.count);
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes[i] === 1) {
      map.WaveExposureHistory[i] = Math.max(map.WaveExposureHistory[i], map.WaveExposure[i]);
      continue;
    }
    let wave = 0;
    for (let edge = 0; edge < 3; edge++) {
      const j = map.mesh.neighbors[i * 3 + edge];
      if (j >= 0 && map.WaterKindCodes[j] === 1) wave = Math.max(wave, map.WaveExposure[j]);
    }
    waves[i] = wave;
    map.WaveExposureHistory[i] = Math.max(map.WaveExposureHistory[i], wave);
  }
  return waves;
}
function shelteredTarget(
  map: PhysicalField,
  waves: Int32Array,
  source: number,
  sourceWave: number
): number {
  let target = -1,
    targetWave = sourceWave;
  for (let edge = 0; edge < 3; edge++) {
    const j = map.mesh.neighbors[source * 3 + edge];
    if (j < 0) continue;
    const wave = map.WaterKindCodes[j] === 1 ? map.WaveExposure[j] : waves[j];
    if (wave < targetWave) {
      target = j;
      targetWave = wave;
    }
  }
  return target;
}
function recordCoastalCut(
  map: PhysicalField,
  c: PhysicalContext,
  source: number,
  target: number,
  cut: number
) {
  erode(map, source, cut);
  map.CumulativeCoastalErosion[source] += cut;
  map.SedimentProducedTotal += cut;
  const amount = target < 0 ? 0 : ratio(cut, c.Profile.CoastalDepositionFraction, 1000);
  if (amount > 0) deposit(map, target, amount);
  map.SedimentExportedTotal += cut - amount;
}
export function coastalErosion(map: PhysicalField, c: PhysicalContext) {
  const waves = coastalWaves(map),
    p = c.Profile;
  for (let i = 0; i < map.mesh.count; i++) {
    const wave = waves[i];
    if (wave < p.CoastalErosionWaveThreshold || map.WaterKindCodes[i] !== 0) continue;
    const shelfSlope = clamp(map.Slope[i] / 1024, 0, 1000);
    const forcing =
      ((wave - p.CoastalErosionWaveThreshold) * p.CoastalErosionStrength) / 1000 +
      shelfSlope / 18 +
      Math.abs(p.CoastalSeaLevelChange);
    const cut = ratio(
      units(clamp(forcing / coastalResistance(map, p, i), 0, p.MaximumCoastalErosionPerPass)),
      c.CoastalStrength,
      1000
    );
    if (cut > 0) recordCoastalCut(map, c, i, shelteredTarget(map, waves, i, wave), cut);
  }
}
function bestOceanTarget(map: PhysicalField, i: number): number {
  let target = -1,
    energy = 2147483647;
  for (let edge = 0; edge < 3; edge++) {
    const j = map.mesh.neighbors[i * 3 + edge];
    if (j < 0 || map.WaterKindCodes[j] !== 1) continue;
    const candidate = map.WaveExposure[j] + map.OceanCurrentStrength[j];
    if (candidate < energy) {
      target = j;
      energy = candidate;
    }
  }
  return target;
}
export function externalCoastalForcing(map: PhysicalField, c: PhysicalContext) {
  for (let i = 0; i < map.mesh.count; i++) {
    const forcing = map.ExternalCoastalForcing[i];
    if (forcing <= 0) continue;
    if (forcing > 1000 || map.WaterKindCodes[i] !== 0)
      throw new Error("External coastal forcing must target dry terrain.");
    const target = bestOceanTarget(map, i);
    if (target < 0) continue;
    map.ExternalCoastalForcingHistory[i] = Math.max(map.ExternalCoastalForcingHistory[i], forcing);
    let cut = units(
      (forcing * c.Profile.MaximumCoastalErosionPerPass * c.CoastalStrength) / 1000000
    );
    if (cut === 0 && c.CoastalStrength > 0) cut = 1;
    if (cut > 0) recordCoastalCut(map, c, i, target, cut);
  }
  map.ExternalCoastalForcing.fill(0);
}
