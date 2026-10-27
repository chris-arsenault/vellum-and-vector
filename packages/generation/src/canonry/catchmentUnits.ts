import type { PhysicalField } from "./field";
import { orderedIndices } from "./numericalOrder";
import { workingArray, releaseWorking } from "./physicalNumerics";

/** Each trunk cell's reach: the river between confluences, named by its uppermost cell. */
function trunkReaches(map: PhysicalField, trunk: number) {
  const isTrunk = (i: number) => map.CatchmentArea[i] >= trunk,
    inflow = workingArray(map, "int32", "region:inflow"),
    upstream = workingArray(map, "int32", "region:upstream").fill(-1),
    reach = workingArray(map, "int32", "region:reach").fill(-1);
  for (let i = 0; i < map.mesh.count; i++) {
    if (!isTrunk(i)) continue;
    const target = map.FlowTargets[i];
    if (target < 0 || !isTrunk(target)) continue;
    inflow[target]++;
    upstream[target] = i;
  }
  // Catchment grows downstream, so ascending catchment visits upstream reaches first.
  const order = orderedIndices(map.CatchmentArea, false, map.numerical);
  for (const t of order)
    if (isTrunk(t)) reach[t] = inflow[t] === 1 && reach[upstream[t]] >= 0 ? reach[upstream[t]] : t;
  releaseWorking(map, inflow, upstream, order);
  return reach;
}
/** Label catchments by trunk reach, retaining outlets and looping flats as distinct units. */
export function catchmentUnits(map: PhysicalField, trunk: number) {
  const unit = trunkReaches(map, trunk),
    path = workingArray(map, "int32", "region:flow-path"),
    onPath = workingArray(map, "uint8", "region:on-path");
  for (let i = 0; i < map.mesh.count; i++) {
    let cell = i,
      length = 0;
    while (unit[cell] < 0 && !onPath[cell]) {
      path[length++] = cell;
      onPath[cell] = 1;
      if (map.FlowTargets[cell] < 0) break;
      cell = map.FlowTargets[cell];
    }
    const label = unit[cell] >= 0 ? unit[cell] : cell;
    for (let at = 0; at < length; at++) {
      unit[path[at]] = label;
      onPath[path[at]] = 0;
    }
  }
  releaseWorking(map, path, onPath);
  return unit;
}
