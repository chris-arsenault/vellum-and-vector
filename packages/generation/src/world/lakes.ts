import { meshDeltaX } from "./mesh";
// LakeBasinLayer depression discovery, pools and outlets, Canonry 0f62584c.
import { clearWaterSurface, setWaterSurface, type PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { hashUnit } from "./noise";
import { round } from "./math";
import { CellList, type Band } from "@atlas/domain";
import { workingArray, workingValues, releaseWorking } from "./physicalNumerics";
import {
  contributingWater,
  qualifies,
  solveStage,
  splitConnected,
  type Depression,
  type SupportedLake,
} from "./lakeStage";

function clearLakes(map: PhysicalField) {
  map.LakeOutletTargets.fill(-1);
  map.LakeOverflow.fill(0);
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes.get(i) === 2) {
      map.WaterKindCodes.set(i, 0);
      map.WaterBodyIds.set(i, 0);
      clearWaterSurface(map, i);
    }
}
function collectDepressions(
  map: PhysicalField,
  mask: Band,
  marks: Band,
  start: number,
  id: number
): Depression[] {
  marks.set(start, id);
  const collected = new CellList();
  collected.push(start);
  let spill = Number.MAX_VALUE;
  for (let head = 0; head < collected.length; head++) {
    const i = collected.at(head);
    spill = Math.min(spill, map.DrainageElevations.get(i));
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      if (j < 0 || !mask.get(j) || marks.get(j) !== 0) continue;
      marks.set(j, id);
      collected.push(j);
    }
  }
  const wet = new CellList();
  for (let n = 0; n < collected.length; n++) {
    const i = collected.at(n);
    if (spill > map.Elevation.get(i)) wet.push(i);
  }
  return splitConnected(map, wet.finish()).map((members) => ({ id, members, spill }));
}
function addPools(
  map: PhysicalField,
  c: PhysicalContext,
  component: Depression,
  water: Band,
  supported: SupportedLake[]
) {
  const lake = solveStage(map, c.Profile, component, water);
  if (lake === null) return;
  for (const members of splitConnected(map, lake.members)) {
    const depth = members.reduce(
      (maximum, i) => Math.max(maximum, lake.surface - map.Elevation.get(i)),
      0
    );
    const pool = {
      ...lake,
      members,
      depth,
      overflow: members.length === lake.members.length ? lake.overflow : 0,
    };
    if (qualifies(map, c.Profile, pool)) supported.push(pool);
  }
}
type Outlet = { member: number; target: number; rank: number; drainage: number; geometry: number };
function preferred(candidate: Outlet, best: Outlet): boolean {
  return (
    candidate.rank < best.rank ||
    (candidate.rank === best.rank &&
      (candidate.drainage < best.drainage ||
        (candidate.drainage === best.drainage && candidate.geometry > best.geometry)))
  );
}
function findOutlet(map: PhysicalField, c: PhysicalContext, lake: SupportedLake, marks: Band) {
  let best = {
    member: -1,
    target: -1,
    rank: 2147483647,
    drainage: Number.MAX_VALUE,
    geometry: -Number.MAX_VALUE,
  };
  for (const member of lake.component.members) {
    const target = map.DrainageParents.get(member);
    if (target < 0 || marks.get(target) === lake.component.id) continue;
    const drainage =
      map.WaterKindCodes.get(target) === 1 ? -(2 ** 63) : map.DrainageElevations.get(target);
    if (drainage > lake.component.spill) continue;
    const mx = map.mesh.x(member),
      my = map.mesh.y(member);
    const x = round(Math.fround(2 * mx + meshDeltaX(map.mesh, map.mesh.x(target) - mx)) * 512);
    const y = round(Math.fround(my + map.mesh.y(target)) * 512);
    const candidate = {
      member,
      target,
      rank: map.DrainageRanks.get(member),
      drainage,
      geometry: hashUnit(c.Seed ^ 0x5b91, x, y),
    };
    if (preferred(candidate, best)) best = candidate;
  }
  return best;
}
function markLake(
  map: PhysicalField,
  c: PhysicalContext,
  lake: SupportedLake,
  marks: Band,
  id: number
) {
  for (const i of lake.members) {
    map.WaterKindCodes.set(i, 2);
    map.WaterBodyIds.set(i, id);
    setWaterSurface(map, i, lake.surface);
  }
  if (lake.overflow <= 0 || lake.surface < lake.component.spill) return;
  const outlet = findOutlet(map, c, lake, marks);
  if (outlet.member >= 0) {
    map.LakeOutletTargets.set(outlet.member, outlet.target);
    map.LakeOverflow.set(outlet.member, lake.overflow);
  }
}
export function lakeBasins(map: PhysicalField, c: PhysicalContext, incoming?: Band) {
  clearLakes(map);
  const water = contributingWater(map, incoming),
    mask = workingValues(map, "uint8", "lakes:mask", (i) =>
      Number(
        map.WaterKindCodes.get(i) === 0 &&
          map.DrainageElevations.get(i) - map.Elevation.get(i) >= 1024
      )
    ),
    marks = workingArray(map, "int32", "lakes:marks");
  let componentId = 0;
  const supported: SupportedLake[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask.get(i) || marks.get(i) !== 0) continue;
    for (const component of collectDepressions(map, mask, marks, i, ++componentId))
      addPools(map, c, component, water, supported);
  }
  // hpc-exempt: one record per retained lake, ordered by first member.
  supported.sort((a, b) => a.members[0] - b.members[0]);
  for (const [index, lake] of supported.entries()) markLake(map, c, lake, marks, index + 2);
  releaseWorking(map, water, mask, marks);
}
