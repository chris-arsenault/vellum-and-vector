// OceanDistanceLayer, BathymetryLayer and LandmassLayer, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { units } from "./math";

function retainInheritedDistance(map: PhysicalField, inherited: Int32Array | null) {
  if (!inherited) return;
  for (let i = 0; i < inherited.length; i++)
    if (inherited[i] >= 0 && (map.OceanDistance[i] < 0 || inherited[i] < map.OceanDistance[i]))
      map.OceanDistance[i] = inherited[i];
}
export function oceanDistance(map: PhysicalField) {
  const inherited = map.OpenBoundary ? map.OceanDistance.slice() : null;
  map.OceanDistance.fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes[i] === 1) {
      map.OceanDistance[i] = 0;
      queue.push(i);
    }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    for (let edge = 0; edge < 3; edge++) {
      const j = map.mesh.neighbors[i * 3 + edge];
      if (j < 0 || map.OceanDistance[j] >= 0) continue;
      map.OceanDistance[j] = map.OceanDistance[i] + 1;
      queue.push(j);
    }
  }
  retainInheritedDistance(map, inherited);
}
export function measureSlopes(map: PhysicalField) {
  for (let i = 0; i < map.mesh.count; i++) {
    let slope = 0;
    for (let edge = 0; edge < 3; edge++) {
      const j = map.mesh.neighbors[i * 3 + edge];
      if (j >= 0) slope = Math.max(slope, Math.abs(map.Elevation[i] - map.Elevation[j]));
    }
    map.Slope[i] = slope;
  }
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
        map.OceanDistance[i] <= 18;
      map.BathymetricZoneCodes[i] = shelf ? 1 : 0;
    }
  }
}
function collect(
  map: PhysicalField,
  start: number,
  id: number,
  labels: Int32Array,
  eligible: (i: number) => boolean
) {
  const members = [start];
  labels[start] = id;
  for (let head = 0; head < members.length; head++)
    for (let edge = 0; edge < 3; edge++) {
      const j = map.mesh.neighbors[members[head] * 3 + edge];
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
    const code = members.length >= c.Profile.IslandTriangleThreshold ? 2 : 1;
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
