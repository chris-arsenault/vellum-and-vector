import type { PhysicalField } from "./field";
import { clearWaterSurface, reconcileWater } from "./field";
import { CellList, type NumericalVector } from "@atlas/domain";
import { lakeMembership } from "./lakeMembership";

function lakeLevel(map: PhysicalField, cells: NumericalVector, volume: number) {
  cells.sort((a, b) => map.Elevation[a] - map.Elevation[b]);
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
  const inventory = new Map<number, number>();
  for (let i = 0; i < previous.mesh.count; i++) {
    if (previous.WaterKindCodes[i] !== 2) continue;
    const id = previous.WaterBodyIds[i];
    if (!inventory.has(id)) inventory.set(id, 0);
    inventory.set(id, inventory.get(id)! + previous.WaterDepths[i] * previous.mesh.areas[i]);
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
  try {
    for (const id of membership.bodies.keys()) {
      const selected = new CellList();
      for (const i of membership.members(id)) selected.push(i);
      const cells = selected.finish();
      const level = lakeLevel(next, cells, inventory.get(id) ?? 0);
      for (const i of cells) {
        next.WaterSurfaceElevations[i] = level;
        reconcileWater(next, i);
      }
    }
  } finally {
    membership.close();
  }
}
