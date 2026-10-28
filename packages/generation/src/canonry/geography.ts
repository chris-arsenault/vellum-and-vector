// OceanDistanceLayer, BathymetryLayer and LandmassLayer, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { NumericalVector } from "@atlas/domain";
import type { PhysicalContext } from "./context";
import { units } from "./math";
import { metricSearch } from "./metricSearch";
import { physicalGradients } from "./physicalMetric";
import { workingArray, releaseWorking } from "./physicalNumerics";

function retainInheritedDistance(map: PhysicalField, inherited: NumericalVector | null) {
  if (!inherited) return;
  for (let i = 0; i < inherited.length; i++)
    if (inherited[i] >= 0 && (map.OceanDistance[i] < 0 || inherited[i] < map.OceanDistance[i]))
      map.OceanDistance[i] = inherited[i];
}
export function oceanDistance(map: PhysicalField) {
  const inherited = map.OpenBoundary ? map.OceanDistance.slice() : null;
  map.OceanDistance.fill(Infinity);
  const queue = workingArray(map, "int32", "distance:seeds");
  let count = 0;
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes[i] === 1) {
      map.OceanDistance[i] = 0;
      if (touchesLand(map, i)) queue[count++] = i;
    }
  metricSearch(map.mesh, queue.subarray(0, count), map.OceanDistance, Infinity, () => {});
  for (let i = 0; i < map.mesh.count; i++)
    if (!Number.isFinite(map.OceanDistance[i])) map.OceanDistance[i] = -1;
  retainInheritedDistance(map, inherited);
  releaseWorking(map, queue, ...(inherited ? [inherited] : []));
}
function touchesLand(map: PhysicalField, i: number) {
  for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
    const j = map.mesh.neighbors[i * map.mesh.stride + edge];
    if (j >= 0 && map.WaterKindCodes[j] !== 1) return true;
  }
  return false;
}
export function measureSlopes(map: PhysicalField) {
  const gradient = physicalGradients(map.mesh, map.Elevation, map.numerical);
  for (let i = 0; i < map.mesh.count; i++)
    map.Slope[i] = Math.hypot(gradient.x[i], gradient.y[i]) / 1024;
  releaseWorking(map, gradient.x, gradient.y);
}
export function bathymetry(map: PhysicalField, c: PhysicalContext) {
  measureSlopes(map);
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes[i] === 1) {
      map.BathymetricZoneCodes[i] =
        map.WaterDepths[i] <= units(c.Profile.ShelfDepth)
          ? 2
          : map.WaterDepths[i] <= units(c.Profile.ShelfBreakDepth)
            ? 3
            : 4;
    } else {
      const shelf =
        map.Elevation[i] <= map.EffectiveSeaLevel + units(c.Profile.ShelfDepth / 2) &&
        map.OceanDistance[i] >= 0 &&
        map.OceanDistance[i] <= 180_000;
      map.BathymetricZoneCodes[i] = shelf ? 1 : 0;
    }
  }
}
function collect(
  map: PhysicalField,
  start: number,
  id: number,
  labels: NumericalVector,
  eligible: (i: number) => boolean
) {
  const members = [start];
  labels[start] = id;
  for (let head = 0; head < members.length; head++)
    for (let edge = 0; edge < map.mesh.degree[members[head]]; edge++) {
      const j = map.mesh.neighbors[members[head] * map.mesh.stride + edge];
      if (j < 0 || labels[j] !== 0 || !eligible(j)) continue;
      labels[j] = id;
      members.push(j);
    }
  return members;
}
export function landmasses(map: PhysicalField, c: PhysicalContext) {
  map.LandmassIds.fill(0);
  map.LandmassClassCodes.fill(0);
  map.ContinentalGroupIds.fill(0);
  const dry = (i: number) =>
    map.WaterKindCodes[i] === 0 && map.Elevation[i] >= map.EffectiveSeaLevel;
  let next = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    if (!dry(i) || map.LandmassIds[i] !== 0) continue;
    const members = collect(map, i, ++next, map.LandmassIds, dry);
    const area = members.reduce((sum, j) => sum + map.mesh.areas[j], 0);
    const code = area >= c.Profile.IslandAreaThreshold ? 2 : 1;
    for (const j of members) map.LandmassClassCodes[j] = code;
  }
  const shelfFloor = map.EffectiveSeaLevel - units(c.Profile.ShelfBreakDepth);
  const shelf = (i: number) => map.Elevation[i] >= shelfFloor;
  next = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    if (!shelf(i) || map.ContinentalGroupIds[i] !== 0) continue;
    collect(map, i, ++next, map.ContinentalGroupIds, shelf);
  }
}
