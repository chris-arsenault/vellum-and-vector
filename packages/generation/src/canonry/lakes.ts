import { meshDeltaX } from "./mesh";
// LakeBasinLayer depression discovery, pools and outlets, Canonry 0f62584c.
import { clearWaterSurface, setWaterSurface, type PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { hashUnit } from "./noise";
import { round } from "./math";
import { CellList, type NumericalVector } from "@atlas/domain";
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
    if (map.WaterKindCodes[i] === 2) {
      map.WaterKindCodes[i] = 0;
      map.WaterBodyIds[i] = 0;
      clearWaterSurface(map, i);
    }
}
function collectDepressions(
  map: PhysicalField,
  mask: NumericalVector,
  marks: NumericalVector,
  start: number,
  id: number
): Depression[] {
  marks[start] = id;
  const collected = new CellList();
  collected.push(start);
  let spill = Number.MAX_VALUE;
  for (let head = 0; head < collected.length; head++) {
    const i = collected.at(head);
    spill = Math.min(spill, map.DrainageElevations[i]);
    for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
      const j = map.mesh.neighbors[i * map.mesh.stride + edge];
      if (j < 0 || !mask[j] || marks[j] !== 0) continue;
      marks[j] = id;
      collected.push(j);
    }
  }
  const wet = new CellList();
  for (let n = 0; n < collected.length; n++) {
    const i = collected.at(n);
    if (spill > map.Elevation[i]) wet.push(i);
  }
  return splitConnected(map, wet.finish()).map((members) => ({ id, members, spill }));
}
function addPools(
  map: PhysicalField,
  c: PhysicalContext,
  component: Depression,
  water: NumericalVector,
  supported: SupportedLake[]
) {
  const lake = solveStage(map, c.Profile, component, water);
  if (lake === null) return;
  for (const members of splitConnected(map, lake.members)) {
    const depth = members.reduce(
      (maximum, i) => Math.max(maximum, lake.surface - map.Elevation[i]),
      0
    );
    const pool = {
      ...lake,
      members,
      depth,
      overflow: members.length === lake.members.length ? lake.overflow : 0,
    };
    if (qualifies(map, c.Profile, pool)) supported.push(pool);
    else releaseWorking(map, members);
  }
  releaseWorking(map, lake.members);
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
function findOutlet(
  map: PhysicalField,
  c: PhysicalContext,
  lake: SupportedLake,
  marks: NumericalVector
) {
  let best = {
    member: -1,
    target: -1,
    rank: 2147483647,
    drainage: Number.MAX_VALUE,
    geometry: -Number.MAX_VALUE,
  };
  for (const member of lake.component.members) {
    const target = map.DrainageParents[member];
    if (target < 0 || marks[target] === lake.component.id) continue;
    const drainage = map.WaterKindCodes[target] === 1 ? -(2 ** 63) : map.DrainageElevations[target];
    if (drainage > lake.component.spill) continue;
    const x = round(
      Math.fround(
        2 * map.mesh.x[member] + meshDeltaX(map.mesh, map.mesh.x[target] - map.mesh.x[member])
      ) * 512
    );
    const y = round(Math.fround(map.mesh.y[member] + map.mesh.y[target]) * 512);
    const candidate = {
      member,
      target,
      rank: map.DrainageRanks[member],
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
  marks: NumericalVector,
  id: number
) {
  for (const i of lake.members) {
    map.WaterKindCodes[i] = 2;
    map.WaterBodyIds[i] = id;
    setWaterSurface(map, i, lake.surface);
  }
  if (lake.overflow <= 0 || lake.surface < lake.component.spill) return;
  const outlet = findOutlet(map, c, lake, marks);
  if (outlet.member >= 0) {
    map.LakeOutletTargets[outlet.member] = outlet.target;
    map.LakeOverflow[outlet.member] = lake.overflow;
  }
}
export function lakeBasins(map: PhysicalField, c: PhysicalContext, incoming?: NumericalVector) {
  clearLakes(map);
  const water = contributingWater(map, incoming),
    mask = workingValues(map, "uint8", "lakes:mask", (i) =>
      Number(map.WaterKindCodes[i] === 0 && map.DrainageElevations[i] - map.Elevation[i] >= 1024)
    ),
    marks = workingArray(map, "int32", "lakes:marks");
  let componentId = 0;
  const supported: SupportedLake[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || marks[i] !== 0) continue;
    for (const component of collectDepressions(map, mask, marks, i, ++componentId)) {
      const before = supported.length;
      addPools(map, c, component, water, supported);
      if (supported.length === before) releaseWorking(map, component.members);
    }
  }
  // hpc-exempt: one record per retained lake, ordered by first member.
  supported.sort((a, b) => a.members[0] - b.members[0]);
  for (const [index, lake] of supported.entries()) markLake(map, c, lake, marks, index + 2);
  for (const lake of supported) releaseWorking(map, lake.members, lake.component.members);
  releaseWorking(map, water, mask, marks);
}
