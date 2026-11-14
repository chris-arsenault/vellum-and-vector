// CoastalErosionLayer.cs and ExternalCoastalForcingLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { carryOut, erodeFacets } from "../rock/groundLedger";
import { depositPond } from "../rock/groundDeposition";
import { loadOf } from "../rock/groundLoad";
import type { MaterialLayer } from "../rock/rockColumn";
import { MapScale, type Band } from "@atlas/domain";
import type { CoastalFrame } from "./coastalFrame";
import { metricSearch } from "./metricSearch";
import { releaseWorking, workingArray } from "./physicalNumerics";

function depositionTargets(
  map: PhysicalField,
  frame: CoastalFrame,
  source: number,
  reach: number,
  oceanOnly: boolean
): [number, number][] {
  const visited = new Set<number>(),
    targets: [number, number][] = [],
    sourceStrength = frame.strength.get(source),
    distance = workingArray(map, "float64", "coast:distance").fill(Infinity);
  distance.set(source, 0);
  try {
    metricSearch(
      map.mesh,
      [source],
      distance,
      reach,
      (target) => {
        visited.add(target);
      },
      // A dry shore can receive material, but cannot relay it across land to another sea.
      (i, _, edge) =>
        i === source || map.WaterKindCodes.get(i) === 1 ? map.mesh.edgeLength(i, edge) : Infinity
    );
    for (const target of visited) {
      if (distance.get(target) >= reach) continue;
      const ocean = map.WaterKindCodes.get(target) === 1,
        wave = ocean ? map.WaveExposure.get(target) : frame.strength.get(target),
        shelter = oceanOnly
          ? Number(ocean) / (1 + wave + map.OceanCurrentStrength.get(target))
          : Math.max(0, sourceStrength - wave);
      if (shelter > 0)
        targets.push([
          target,
          shelter * (1 - distance.get(target) / reach) * map.mesh.area(target),
        ]);
    }
  } finally {
    releaseWorking(map, distance);
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
      cargo.add(landing, {
        ...material,
        depth: MapScale.metres(material.depth, "native") * map.mesh.area(source),
      })
    );
  map.CumulativeCoastalErosion.add(source, removed);
  const volume = MapScale.metres(removed, "native") * map.mesh.area(source);
  map.SedimentProducedTotal += volume;
  return volume;
}
function depositCoastalVolume(
  map: PhysicalField,
  c: PhysicalContext,
  source: number,
  targets: [number, number][],
  material: MaterialLayer,
  wave: number
) {
  const volume = material.depth;
  let remaining = (volume * c.Profile.CoastalDepositionFraction) / 1000,
    weight = targets.reduce((sum, [, value]) => sum + value, 0),
    deposited = 0;
  for (const [target, share] of targets) {
    const amount = Math.min(remaining, (remaining * share) / weight),
      area = map.mesh.area(target);
    // Wave run-up gives transported sediment room above still water, allowing an inlet bar
    // to emerge when actual supply exceeds submerged accommodation.
    const actual =
      MapScale.metres(
        depositPond(
          map,
          target,
          MapScale.inUnits(amount / area, "native"),
          map.EffectiveSeaLevel + MapScale.native((map.scale.length(0.000005) * wave) / 1000),
          "coast",
          "load",
          material
        ),
        "native"
      ) * area;
    deposited += actual;
    remaining = Math.max(0, remaining - actual);
    weight -= share;
  }
  const remainingMaterial = { ...material, depth: volume - deposited },
    entry =
      map.WaterKindCodes.get(source) === 1
        ? source
        : targets.find(([target]) => map.WaterKindCodes.get(target) === 1)?.[0];
  if (entry !== undefined)
    carryOut(map, remainingMaterial.depth, "coast", remainingMaterial, entry);
  else loadOf(map).add(source, remainingMaterial);
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
      i,
      depositionTargets(map, frame, i, c.Profile.CoastalDepositionReach * c.Span, oceanOnly),
      loadOf(map).take(i, load),
      Math.max(frame.strength.get(i), map.WaveExposure.get(i))
    );
  }
}
