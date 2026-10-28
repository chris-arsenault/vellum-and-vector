import type { PhysicalField } from "./field";
import { clearWaterSurface, reconcileWater } from "./field";
import { radixOrder, type NumericalVector } from "@atlas/domain";
import { lakeMembership } from "./lakeMembership";

function lakeLevel(map: PhysicalField, members: NumericalVector, volume: number) {
  const cells = Int32Array.from(
    radixOrder(Float64Array.from(members, (i) => map.Elevation[i])),
    (k) => members[k]
  );
  let area = 0,
    floorIntegral = 0;
  for (let n = 0; n < cells.length; n++) {
    const i = cells[n];
    area += map.mesh.areas[i];
    floorIntegral += map.Elevation[i] * map.mesh.areas[i];
    const level = (volume + floorIntegral) / area;
    if (n === cells.length - 1 || level <= map.Elevation[cells[n + 1]]) return level;
  }
  throw new Error("A retained lake requires physical support.");
}
/** Remeshing changes support, not lake inventory or elapsed hydrological time. */
function lakeInventory(previous: PhysicalField) {
  // Water volume per body id; ids are small positive integers.
  let size = 0;
  for (let i = 0; i < previous.mesh.count; i++)
    if (previous.WaterKindCodes[i] === 2) size = Math.max(size, previous.WaterBodyIds[i] + 1);
  const inventory = new Float64Array(size);
  for (let i = 0; i < previous.mesh.count; i++) {
    if (previous.WaterKindCodes[i] !== 2) continue;
    inventory[previous.WaterBodyIds[i]] += previous.WaterDepths[i] * previous.mesh.areas[i];
  }
  return inventory;
}
export function reconcileRemeshedWater(previous: PhysicalField, next: PhysicalField) {
  const inventory = lakeInventory(previous),
    membership = lakeMembership(next);
  for (let i = 0; i < next.mesh.count; i++) {
    if (next.WaterKindCodes[i] === 2) continue;
    if (next.WaterKindCodes[i] === 1) reconcileWater(next, i);
    else clearWaterSurface(next, i);
  }
  for (const id of membership.bodies()) {
    const cells = membership.members(id),
      level = lakeLevel(next, cells, inventory[id] ?? 0);
    for (const i of cells) {
      next.WaterSurfaceElevations[i] = level;
      reconcileWater(next, i);
    }
  }
}
