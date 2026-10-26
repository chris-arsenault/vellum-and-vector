import { meshDeltaX } from "./mesh";
// LakeBasinLayer depression discovery, pools and outlets, Canonry 0f62584c.
import { clearWaterSurface, setWaterSurface, type PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { hashUnit } from "./noise";
import { round } from "./math";
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
  mask: Uint8Array,
  marks: Int32Array,
  start: number,
  id: number
): Depression[] {
  marks[start] = id;
  const collected = [start];
  let spill = Number.MAX_VALUE;
  for (let head = 0; head < collected.length; head++) {
    const i = collected[head];
    spill = Math.min(spill, map.DrainageElevations[i]);
    for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
      const j = map.mesh.neighbors[i * map.mesh.stride + edge];
      if (j < 0 || !mask[j] || marks[j] !== 0) continue;
      marks[j] = id;
      collected.push(j);
    }
  }
  const submerged = new Set(collected.filter((i) => spill > map.Elevation[i]));
  return splitConnected(map, submerged).map((members) => ({ id, members, spill }));
}
function addPools(
  map: PhysicalField,
  c: PhysicalContext,
  component: Depression,
  water: Float64Array,
  supported: SupportedLake[]
) {
  const lake = solveStage(map, c.Profile, component, water);
  if (lake === null) return;
  for (const members of splitConnected(map, new Set(lake.members))) {
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
function findOutlet(
  map: PhysicalField,
  c: PhysicalContext,
  lake: SupportedLake,
  marks: Int32Array
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
  marks: Int32Array,
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
export function lakeBasins(map: PhysicalField, c: PhysicalContext, incoming?: Float64Array) {
  clearLakes(map);
  const water = contributingWater(map, incoming),
    mask = new Uint8Array(map.mesh.count),
    marks = new Int32Array(map.mesh.count);
  for (let i = 0; i < mask.length; i++)
    if (map.WaterKindCodes[i] === 0 && map.DrainageElevations[i] - map.Elevation[i] >= 1024)
      mask[i] = 1;
  let componentId = 0;
  const supported: SupportedLake[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || marks[i] !== 0) continue;
    for (const component of collectDepressions(map, mask, marks, i, ++componentId))
      addPools(map, c, component, water, supported);
  }
  supported.sort((a, b) => a.members[0] - b.members[0]);
  for (const [index, lake] of supported.entries()) markLake(map, c, lake, marks, index + 2);
}
