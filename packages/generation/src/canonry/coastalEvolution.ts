// CoastalErosionLayer.cs and ExternalCoastalForcingLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { PhysicalProfile } from "./profile";
import { clamp, toUnits, units } from "./math";
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
interface Shore {
  x: number;
  y: number;
  strength: number;
}
interface CoastalFrame {
  strength: Int32Array;
  coverage: Float64Array;
  source: Int32Array;
}
function seedShores(map: PhysicalField, forcing?: Int32Array) {
  const shores: Shore[] = [],
    seeds: number[] = [];
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes[i] !== 0) continue;
    for (let edge = 0; edge < 3; edge++) {
      const j = map.mesh.neighbors[i * 3 + edge];
      if (j < 0 || map.WaterKindCodes[j] !== 1) continue;
      const strength = forcing ? forcing[i] : map.WaveExposure[j];
      if (strength <= 0) continue;
      shores.push({
        x: (map.mesh.x[i] + map.mesh.x[j]) / 2,
        y: (map.mesh.y[i] + map.mesh.y[j]) / 2,
        strength,
      });
      seeds.push(i);
    }
  }
  return { shores, seeds };
}
/** Fractional cell coverage of a physical shore band, including unresolved strips. */
function coastalFrame(map: PhysicalField, width: number, forcing?: Int32Array): CoastalFrame {
  const { shores, seeds } = seedShores(map, forcing),
    nearest = new Int32Array(map.mesh.count).fill(-1),
    distance = new Float64Array(map.mesh.count).fill(Infinity),
    queue: number[] = [];
  const offer = (i: number, source: number) => {
    const shore = shores[source],
      d = Math.hypot(map.mesh.x[i] - shore.x, map.mesh.y[i] - shore.y);
    if (d > width + map.mesh.spacing / 2 || d > distance[i]) return;
    if (d === distance[i] && nearest[i] >= 0 && shore.strength <= shores[nearest[i]].strength)
      return;
    distance[i] = d;
    nearest[i] = source;
    queue.push(i);
  };
  seeds.forEach((i, source) => offer(i, source));
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    for (let edge = 0; edge < 3; edge++) {
      const j = map.mesh.neighbors[i * 3 + edge];
      if (j >= 0 && map.WaterKindCodes[j] === 0) offer(j, nearest[i]);
    }
  }
  const strength = new Int32Array(map.mesh.count),
    coverage = new Float64Array(map.mesh.count),
    source = new Int32Array(map.mesh.count).fill(-1);
  for (let i = 0; i < map.mesh.count; i++) {
    if (nearest[i] < 0) continue;
    coverage[i] = clamp((width - distance[i]) / map.mesh.spacing + 0.5, 0, 1);
    strength[i] = shores[nearest[i]].strength;
    source[i] = seeds[nearest[i]];
  }
  return { strength, coverage, source };
}
function depositionTargets(
  map: PhysicalField,
  frame: CoastalFrame,
  source: number,
  reach: number,
  oceanOnly: boolean
): [number, number][] {
  const queue = [source],
    visited = new Set(queue),
    targets: [number, number][] = [];
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    for (let edge = 0; edge < 3; edge++) {
      const j = map.mesh.neighbors[i * 3 + edge];
      if (j < 0 || visited.has(j)) continue;
      visited.add(j);
      const distance = Math.hypot(
        map.mesh.x[j] - map.mesh.x[source],
        map.mesh.y[j] - map.mesh.y[source]
      );
      if (distance >= reach) continue;
      queue.push(j);
      const ocean = map.WaterKindCodes[j] === 1,
        wave = ocean ? map.WaveExposure[j] : frame.strength[j];
      const shelter = oceanOnly
        ? Number(ocean) / (1 + wave + map.OceanCurrentStrength[j])
        : Math.max(0, frame.strength[source] - wave);
      if (shelter > 0) targets.push([j, shelter * (1 - distance / reach) * map.mesh.areas[j]]);
    }
  }
  return targets;
}
function recordCoastalCut(map: PhysicalField, source: number, cut: number) {
  const removed = erode(map, source, cut);
  map.CumulativeCoastalErosion[source] += removed;
  const volume = (removed / 1024) * map.mesh.areas[source];
  map.SedimentProducedTotal += volume;
  return volume;
}
function depositCoastalVolume(
  map: PhysicalField,
  c: PhysicalContext,
  targets: [number, number][],
  volume: number
) {
  let remaining = (volume * c.Profile.CoastalDepositionFraction) / 1000,
    weight = targets.reduce((sum, [, value]) => sum + value, 0),
    deposited = 0;
  for (const [target, share] of targets) {
    const amount = Math.min(remaining, (remaining * share) / weight);
    const actual =
      (deposit(map, target, (amount * 1024) / map.mesh.areas[target]) / 1024) *
      map.mesh.areas[target];
    deposited += actual;
    remaining = Math.max(0, remaining - actual);
    weight -= share;
  }
  map.SedimentExportedTotal += volume - deposited;
}
function depositShoreLoads(
  map: PhysicalField,
  c: PhysicalContext,
  frame: CoastalFrame,
  loads: Float64Array,
  oceanOnly: boolean
) {
  for (let i = 0; i < loads.length; i++) {
    if (loads[i] <= 0) continue;
    depositCoastalVolume(
      map,
      c,
      depositionTargets(map, frame, i, c.Profile.CoastalDepositionReach, oceanOnly),
      loads[i]
    );
  }
}
export function coastalErosion(map: PhysicalField, c: PhysicalContext) {
  const p = c.Profile,
    frame = coastalFrame(map, p.CoastalActiveWidth),
    loads = new Float64Array(map.mesh.count);
  for (let i = 0; i < map.mesh.count; i++) {
    const wave = frame.strength[i];
    if (map.WaterKindCodes[i] === 1)
      map.WaveExposureHistory[i] = Math.max(map.WaveExposureHistory[i], map.WaveExposure[i]);
    else if (frame.coverage[i] > 0)
      map.WaveExposureHistory[i] = Math.max(map.WaveExposureHistory[i], wave);
    if (wave < p.CoastalErosionWaveThreshold || map.WaterKindCodes[i] !== 0) continue;
    const shelfSlope = clamp(map.Slope[i] * 10_000, 0, 1000);
    const forcing =
      ((wave - p.CoastalErosionWaveThreshold) * p.CoastalErosionStrength) / 1000 +
      shelfSlope / 18 +
      Math.abs(p.CoastalSeaLevelChange);
    const cut = units(
      (clamp(forcing / coastalResistance(map, p, i), 0, p.MaximumCoastalErosionPerPass) *
        c.CoastalStrength *
        frame.coverage[i]) /
        1000
    );
    if (cut > 0) loads[frame.source[i]] += recordCoastalCut(map, i, cut);
  }
  depositShoreLoads(map, c, frame, loads, false);
}
export function externalCoastalForcing(map: PhysicalField, c: PhysicalContext) {
  for (let i = 0; i < map.mesh.count; i++) {
    const forcing = map.ExternalCoastalForcing[i];
    if (forcing > 1000 || (forcing > 0 && map.WaterKindCodes[i] !== 0))
      throw new Error("External coastal forcing must target dry terrain.");
  }
  const p = c.Profile,
    frame = coastalFrame(map, p.CoastalActiveWidth, map.ExternalCoastalForcing),
    loads = new Float64Array(map.mesh.count);
  for (let i = 0; i < map.mesh.count; i++) {
    const forcing = frame.strength[i];
    if (forcing <= 0 || frame.coverage[i] <= 0) continue;
    map.ExternalCoastalForcingHistory[i] = Math.max(map.ExternalCoastalForcingHistory[i], forcing);
    const cut = units(
      (forcing * p.MaximumCoastalErosionPerPass * c.CoastalStrength * frame.coverage[i]) / 1000000
    );
    if (cut > 0) loads[frame.source[i]] += recordCoastalCut(map, i, cut);
  }
  depositShoreLoads(map, c, frame, loads, true);
  map.ExternalCoastalForcing.fill(0);
}
