// OceanDistanceLayer, BathymetryLayer and LandmassLayer, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import { CellList, MapScale, type Band } from "@atlas/domain";
import type { PhysicalContext } from "./context";
import { metricSearch } from "./metricSearch";
import { physicalGradients } from "./physicalMetric";
import { releaseWorking } from "./physicalNumerics";

function retainInheritedDistance(map: PhysicalField, inherited: Band | null) {
  if (!inherited) return;
  for (let i = 0; i < inherited.length; i++) {
    const held = inherited.get(i),
      current = map.OceanDistance.get(i);
    if (held >= 0 && (current < 0 || held < current)) map.OceanDistance.set(i, held);
  }
}
export function oceanDistance(map: PhysicalField) {
  const inherited = map.OpenBoundary ? map.coverage.copyBand(map.OceanDistance) : null;
  map.OceanDistance.fill(Infinity);
  const seeds = new CellList();
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes.get(i) === 1) {
      map.OceanDistance.set(i, 0);
      if (touchesLand(map, i)) seeds.push(i);
    }
  metricSearch(map.mesh, seeds.finish(), map.OceanDistance, Infinity, () => {});
  for (let i = 0; i < map.mesh.count; i++)
    if (!Number.isFinite(map.OceanDistance.get(i))) map.OceanDistance.set(i, -1);
  retainInheritedDistance(map, inherited);
  if (inherited) releaseWorking(map, inherited);
}
function touchesLand(map: PhysicalField, i: number) {
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const j = map.mesh.neighbor(i, edge);
    if (j >= 0 && map.WaterKindCodes.get(j) !== 1) return true;
  }
  return false;
}
export function measureSlopes(map: PhysicalField) {
  const gradient = physicalGradients(map.mesh, (i) => map.Elevation.get(i), map.coverage);
  for (let i = 0; i < map.mesh.count; i++)
    map.Slope.set(i, MapScale.metres(Math.hypot(gradient.x.get(i), gradient.y.get(i)), "native"));
  releaseWorking(map, gradient.x, gradient.y);
}
/** The bathymetric zone below the shelf break. */
export const deepOceanZone = 4;
export function bathymetry(map: PhysicalField, c: PhysicalContext) {
  measureSlopes(map);
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes.get(i) === 1) {
      const depth = map.WaterDepths.get(i);
      map.BathymetricZoneCodes.set(
        i,
        depth <= MapScale.native(c.Profile.ShelfDepth)
          ? 2
          : depth <= MapScale.native(c.Profile.ShelfBreakDepth)
            ? 3
            : deepOceanZone
      );
    } else {
      const distance = map.OceanDistance.get(i);
      const shelf =
        map.Elevation.get(i) <= map.EffectiveSeaLevel + MapScale.native(c.Profile.ShelfDepth / 2) &&
        distance >= 0 &&
        distance <= map.scale.length(0.045);
      map.BathymetricZoneCodes.set(i, shelf ? 1 : 0);
    }
  }
}
function collect(
  map: PhysicalField,
  start: number,
  id: number,
  labels: Band,
  eligible: (i: number) => boolean
) {
  const members = new CellList();
  members.push(start);
  labels.set(start, id);
  for (let head = 0; head < members.length; head++) {
    const cell = members.at(head);
    for (let edge = 0; edge < map.mesh.degree(cell); edge++) {
      const j = map.mesh.neighbor(cell, edge);
      if (j < 0 || labels.get(j) !== 0 || !eligible(j)) continue;
      labels.set(j, id);
      members.push(j);
    }
  }
  return members.finish();
}
export function landmasses(map: PhysicalField, c: PhysicalContext) {
  map.LandmassIds.fill(0);
  map.LandmassClassCodes.fill(0);
  map.ContinentalGroupIds.fill(0);
  const dry = (i: number) =>
    map.WaterKindCodes.get(i) === 0 && map.Elevation.get(i) >= map.EffectiveSeaLevel;
  let next = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    if (!dry(i) || map.LandmassIds.get(i) !== 0) continue;
    const members = collect(map, i, ++next, map.LandmassIds, dry);
    let area = 0;
    for (const j of members) area += map.mesh.area(j);
    const code = area >= c.Profile.IslandAreaThreshold ? 2 : 1;
    for (const j of members) map.LandmassClassCodes.set(j, code);
  }
  const shelfFloor = map.EffectiveSeaLevel - MapScale.native(c.Profile.ShelfBreakDepth);
  const shelf = (i: number) => map.Elevation.get(i) >= shelfFloor;
  next = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    if (!shelf(i) || map.ContinentalGroupIds.get(i) !== 0) continue;
    collect(map, i, ++next, map.ContinentalGroupIds, shelf);
  }
}
