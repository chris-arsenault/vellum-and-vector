// WarmthSourceLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { lerp, round, truncate, units } from "./math";
import { hashUnit } from "./noise";
import { nearestTriangle, triangleIdentity } from "./mesh";
import { paintMaximum, triangleDistanceSquared } from "./radial";
import type { NumericalVector } from "@atlas/domain";
import { NumericalList } from "./numericalList";
import { releaseWorking } from "./physicalNumerics";

function candidateSets(map: PhysicalField, c: PhysicalContext) {
  const result = Array.from(
    { length: 4 },
    () => new NumericalList("int32", "warmth:candidates", map.numerical)
  );
  for (let i = 0; i < map.mesh.contentCount; i++) {
    if (map.WaterKindCodes[i] === 1) {
      result[0].push(i);
      continue;
    }
    const distance = map.OceanDistance[i],
      peak = units(c.Profile.PeakElevationThreshold);
    if (distance > 0 && distance <= 120_000) result[1].push(i);
    if (distance >= 200_000 && map.Elevation[i] < peak) result[2].push(i);
    if (map.Elevation[i] >= peak && map.Geothermal[i] >= 420) result[3].push(i);
  }
  return result.map((values) => values.finish());
}
function selectSource(
  map: PhysicalField,
  candidates: NumericalVector,
  selected: number[],
  seed: number,
  sourceIndex: number
) {
  if (candidates.length === 0) return nearestTriangle(map.mesh, 0, 0);
  let best = candidates[0],
    bestScore = -Number.MAX_VALUE;
  for (let sample = 0; sample < Math.min(96, candidates.length); sample++) {
    const i =
      candidates[
        truncate(hashUnit(seed, sourceIndex, sample) * candidates.length) % candidates.length
      ];
    const distance =
      selected.length === 0
        ? 0
        : Math.min(...selected.map((j) => triangleDistanceSquared(map.mesh, i, j)));
    const score =
      distance / 100_000_000 +
      map.Geothermal[i] * 0.25 +
      map.OceanCurrentHeat[i] * 0.22 +
      hashUnit(seed ^ 0x4b67, triangleIdentity(map.mesh, i), sample);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return best;
}
export function warmthSources(map: PhysicalField, c: PhysicalContext) {
  const p = c.Profile;
  map.Warmth.fill(0);
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes[i] === 1)
      map.Warmth[i] = truncate((map.OceanCurrentHeat[i] * p.OceanCurrentWarmthStrength) / 1000);
  paintMaximum(map.mesh, map.Warmth, 0, 0, p.HeartWarmthRadius, p.HeartWarmthStrength);
  const candidates = candidateSets(map, c),
    selected: number[] = [];
  for (let index = 0; index < p.WarmthPocketCount; index++) {
    const source = selectSource(
      map,
      candidates[index % candidates.length],
      selected,
      c.Seed,
      index
    );
    selected.push(source);
    const radius = lerp(
      p.WarmthPocketMinRadius,
      p.WarmthPocketMaxRadius,
      hashUnit(c.Seed ^ 0x14d3, index, 0)
    );
    const strength = round(
      lerp(
        p.WarmthPocketMinStrength,
        p.WarmthPocketMaxStrength,
        hashUnit(c.Seed ^ 0x29f1, index, 1)
      )
    );
    paintMaximum(map.mesh, map.Warmth, map.mesh.x[source], map.mesh.y[source], radius, strength);
  }
  releaseWorking(map, ...candidates);
}
