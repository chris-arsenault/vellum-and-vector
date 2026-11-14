import { carriedBy } from "../coupling/carriers";
import type { PhysicalField } from "../world/field";
import type { TransportPlan } from "../world/transportPlan";
import { riverStorage } from "./riverStorage";

/** A course follows the dominant arriving portion of each piece of its ground. */
export function carryRiverGround(map: PhysicalField, plan: TransportPlan) {
  const store = riverStorage(map),
    destination = new Int32Array(map.mesh.count).fill(-1);
  for (let source = 0; source < map.mesh.count; source++) {
    let largest = 0;
    for (let at = plan.offsets.get(source); at < plan.offsets.get(source + 1); at++) {
      const target = plan.targets.get(at),
        weight = plan.weights.get(at);
      if (target >= 0 && weight > largest) {
        destination[source] = target;
        largest = weight;
      }
    }
  }
  for (const reach of store.reaches.values()) {
    const positions = reach.cells
        .map((cell, at) => ({ cell: destination[cell], at }))
        .filter(({ cell }, n, all) => cell >= 0 && (n === 0 || cell !== all[n - 1].cell)),
      cells = positions.map(({ cell }) => cell);
    reach.monthly = Float64Array.from(
      positions.flatMap(({ at }) => Array.from(reach.monthly.subarray(at * 12, (at + 1) * 12)))
    );
    for (const part of ["bed", "width", "depth", "leakage", "catchment"] as const)
      reach[part] = Float64Array.from(positions, ({ at }) => reach[part][at]);
    reach.cells = cells;
    reach.former = reach.former
      .map((course) => ({
        ...course,
        cells: movedCourse(course.cells, destination),
      }))
      .filter((course) => course.cells.length > 0);
    if (!cells.length) reach.dry = true;
  }
  for (const entry of store.entries) entry.cell = destination[entry.cell];
  store.entries = store.entries.filter((entry) => entry.cell >= 0);
  store.at = undefined;
}
function movedCourse(cells: readonly number[], destination: Int32Array) {
  return cells
    .map((cell) => destination[cell])
    .filter((cell, n, all) => cell >= 0 && (!n || cell !== all[n - 1]));
}
carriedBy("rivers", carryRiverGround);
