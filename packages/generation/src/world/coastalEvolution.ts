import { meshDeltaX } from "./mesh";
// CoastalErosionLayer.cs and ExternalCoastalForcingLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { carryOut, deposit, erodeFacets } from "../rock/groundLedger";
import { loadOf } from "../rock/groundLoad";
import type { MaterialLayer } from "../rock/rockColumn";
import type { Band } from "@atlas/domain";
import type { CoastalFrame } from "./coastalFrame";

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
export function recordCoastalCut(
  map: PhysicalField,
  source: number,
  cut: readonly [number, number],
  landing = source
) {
  const cargo = loadOf(map),
    removed = erodeFacets(map, source, cut, "coast", "load", (material) =>
      cargo.add(landing, { ...material, depth: (material.depth / 1024) * map.mesh.area(source) })
    );
  map.CumulativeCoastalErosion.add(source, removed);
  const volume = (removed / 1024) * map.mesh.area(source);
  map.SedimentProducedTotal += volume;
  return volume;
}
function depositCoastalVolume(
  map: PhysicalField,
  c: PhysicalContext,
  targets: [number, number][],
  material: MaterialLayer
) {
  const volume = material.depth;
  let remaining = (volume * c.Profile.CoastalDepositionFraction) / 1000,
    weight = targets.reduce((sum, [, value]) => sum + value, 0),
    deposited = 0;
  for (const [target, share] of targets) {
    const amount = Math.min(remaining, (remaining * share) / weight),
      area = map.mesh.area(target),
      // What waves carry fills the sea up to its surface and no higher; the rest goes out to sea.
      room = Math.max(0, map.EffectiveSeaLevel - map.Elevation.get(target));
    const actual =
      (deposit(map, target, Math.min((amount * 1024) / area, room), "coast", "load", material) /
        1024) *
      area;
    deposited += actual;
    remaining = Math.max(0, remaining - actual);
    weight -= share;
  }
  carryOut(map, volume - deposited, "coast", { ...material, depth: volume - deposited });
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
      depositionTargets(map, frame, i, c.Profile.CoastalDepositionReach * c.Span, oceanOnly),
      loadOf(map).take(i, load)
    );
  }
}
