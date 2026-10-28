import type { PhysicalField } from "./field";
import { workingArray, releaseWorking } from "./physicalNumerics";

/** Each trunk cell's reach: the river between confluences, named by its uppermost cell. */
function trunkReaches(map: PhysicalField, trunk: number) {
  const isTrunk = (i: number) => map.CatchmentArea.get(i) >= trunk,
    inflow = workingArray(map, "int32", "region:inflow"),
    upstream = workingArray(map, "int32", "region:upstream").fill(-1),
    reach = workingArray(map, "int32", "region:reach").fill(-1);
  for (let i = 0; i < map.mesh.count; i++) {
    if (!isTrunk(i)) continue;
    const target = map.FlowTargets.get(i);
    if (target < 0 || !isTrunk(target)) continue;
    inflow.add(target, 1);
    upstream.set(target, i);
  }
  // Catchment grows downstream, so ascending catchment visits upstream reaches first.
  for (const t of map.coverage.order(map.CatchmentArea)) {
    if (!isTrunk(t)) continue;
    const above = inflow.get(t) === 1 ? reach.get(upstream.get(t)) : -1;
    reach.set(t, above >= 0 ? above : t);
  }
  releaseWorking(map, inflow, upstream);
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
    while (unit.get(cell) < 0 && !onPath.get(cell)) {
      path.set(length++, cell);
      onPath.set(cell, 1);
      const target = map.FlowTargets.get(cell);
      if (target < 0) break;
      cell = target;
    }
    const label = unit.get(cell) >= 0 ? unit.get(cell) : cell;
    for (let at = 0; at < length; at++) {
      const on = path.get(at);
      unit.set(on, label);
      onPath.set(on, 0);
    }
  }
  releaseWorking(map, path, onPath);
  return unit;
}
