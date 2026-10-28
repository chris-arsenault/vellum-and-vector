import type { PhysicalField } from "./field";
import { clearWaterSurface, reconcileWater } from "./field";
import { radixOrder } from "@atlas/domain";
import { lakeMembership } from "./lakeMembership";

function lakeLevel(map: PhysicalField, members: ArrayLike<number>, volume: number) {
  const cells = Int32Array.from(
    radixOrder(Float64Array.from(members, (i) => map.Elevation.get(i))),
    (k) => members[k]
  );
  let area = 0,
    floorIntegral = 0;
  for (let n = 0; n < cells.length; n++) {
    const i = cells[n];
    area += map.mesh.area(i);
    floorIntegral += map.Elevation.get(i) * map.mesh.area(i);
    const level = (volume + floorIntegral) / area;
    if (n === cells.length - 1 || level <= map.Elevation.get(cells[n + 1])) return level;
  }
  throw new Error("A retained lake requires physical support.");
}
/** Remeshing changes support, not lake inventory or elapsed hydrological time. */
function lakeInventory(previous: PhysicalField) {
  // Water volume per body id; ids are small positive integers.
  let size = 0;
  for (let i = 0; i < previous.mesh.count; i++)
    if (previous.WaterKindCodes.get(i) === 2)
      size = Math.max(size, previous.WaterBodyIds.get(i) + 1);
  const inventory = new Float64Array(size);
  for (let i = 0; i < previous.mesh.count; i++) {
    if (previous.WaterKindCodes.get(i) !== 2) continue;
    inventory[previous.WaterBodyIds.get(i)] += previous.WaterDepths.get(i) * previous.mesh.area(i);
  }
  return inventory;
}
export function reconcileRemeshedWater(previous: PhysicalField, next: PhysicalField) {
  const inventory = lakeInventory(previous),
    membership = lakeMembership(next);
  for (let i = 0; i < next.mesh.count; i++) {
    if (next.WaterKindCodes.get(i) === 2) continue;
    if (next.WaterKindCodes.get(i) === 1) reconcileWater(next, i);
    else clearWaterSurface(next, i);
  }
  for (const id of membership.bodies()) {
    const cells = membership.members(id),
      level = lakeLevel(next, cells, inventory[id] ?? 0);
    for (const i of cells) {
      next.WaterSurfaceElevations.set(i, level);
      reconcileWater(next, i);
    }
  }
}
