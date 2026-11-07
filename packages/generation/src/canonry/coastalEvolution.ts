import { meshDeltaX } from "./mesh";
// CoastalErosionLayer.cs and ExternalCoastalForcingLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { units } from "./math";
import { deposit, erode } from "../rock/groundLedger";
import type { Band } from "@atlas/domain";
import { workingArray, releaseWorking } from "./physicalNumerics";
import { coastalFrame, type CoastalFrame } from "./coastalFrame";

function depositionTargets(
  map: PhysicalField,
  frame: CoastalFrame,
  source: number,
  reach: number,
  oceanOnly: boolean
): [number, number][] {
  const queue = [source],
    visited = new Set(queue),
    targets: [number, number][] = [],
    sx = map.mesh.x(source),
    sy = map.mesh.y(source),
    sourceStrength = frame.strength.get(source);
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      if (j < 0 || visited.has(j)) continue;
      visited.add(j);
      const distance = Math.hypot(meshDeltaX(map.mesh, map.mesh.x(j) - sx), map.mesh.y(j) - sy);
      if (distance >= reach) continue;
      queue.push(j);
      const ocean = map.WaterKindCodes.get(j) === 1,
        wave = ocean ? map.WaveExposure.get(j) : frame.strength.get(j);
      const shelter = oceanOnly
        ? Number(ocean) / (1 + wave + map.OceanCurrentStrength.get(j))
        : Math.max(0, sourceStrength - wave);
      if (shelter > 0) targets.push([j, shelter * (1 - distance / reach) * map.mesh.area(j)]);
    }
  }
  return targets;
}
export function recordCoastalCut(map: PhysicalField, source: number, cut: number) {
  const removed = erode(map, source, cut, "coast");
  map.CumulativeCoastalErosion.add(source, removed);
  const volume = (removed / 1024) * map.mesh.area(source);
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
    const amount = Math.min(remaining, (remaining * share) / weight),
      area = map.mesh.area(target);
    const actual = (deposit(map, target, (amount * 1024) / area) / 1024) * area;
    deposited += actual;
    remaining = Math.max(0, remaining - actual);
    weight -= share;
  }
  map.SedimentExportedTotal += volume - deposited;
}
export function depositShoreLoads(
  map: PhysicalField,
  c: PhysicalContext,
  frame: CoastalFrame,
  loads: Band,
  oceanOnly: boolean
) {
  for (let i = 0; i < loads.length; i++) {
    const load = loads.get(i);
    if (load <= 0) continue;
    depositCoastalVolume(
      map,
      c,
      depositionTargets(map, frame, i, c.Profile.CoastalDepositionReach, oceanOnly),
      load
    );
  }
}
export function externalCoastalForcing(map: PhysicalField, c: PhysicalContext) {
  for (let i = 0; i < map.mesh.count; i++) {
    const forcing = map.ExternalCoastalForcing.get(i);
    if (forcing > 1000 || (forcing > 0 && map.WaterKindCodes.get(i) !== 0))
      throw new Error("External coastal forcing must target dry terrain.");
  }
  const p = c.Profile,
    frame = coastalFrame(map, p.CoastalActiveWidth, map.ExternalCoastalForcing),
    loads = workingArray(map, "float64", "coast:loads");
  for (let i = 0; i < map.mesh.count; i++) {
    const forcing = frame.strength.get(i),
      coverage = frame.coverage.get(i);
    if (forcing <= 0 || coverage <= 0) continue;
    map.ExternalCoastalForcingHistory.set(
      i,
      Math.max(map.ExternalCoastalForcingHistory.get(i), forcing)
    );
    const cut = units(
      (forcing * p.CoastalWearRate * c.Span * c.CoastalStrength * coverage) / 1000000
    );
    if (cut > 0) loads.add(frame.source.get(i), recordCoastalCut(map, i, cut));
  }
  depositShoreLoads(map, c, frame, loads, true);
  releaseWorking(map, loads, frame.strength, frame.coverage, frame.source);
  map.ExternalCoastalForcing.fill(0);
}
