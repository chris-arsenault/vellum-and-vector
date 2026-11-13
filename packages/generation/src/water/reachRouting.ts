import type { PhysicalField } from "../world/field";
import { edgeLeadingTo } from "../world/mesh";
import type { Band } from "@atlas/domain";

/**
 * Keep the existing bed while it still drains. A newly preferred neighbour alone cannot
 * divert a river. Strict descent, or descending flood rank on a flat, keeps routes acyclic.
 * Uplift, drowning or a disconnected moved course releases only the affected segments.
 */
export function retainRiverRoutes(map: PhysicalField, targets: Band = map.FlowTargets) {
  for (const reach of map.rivers.reaches.values()) {
    for (let at = 0; at + 1 < reach.cells.length; at++) {
      const cell = reach.cells[at],
        next = reach.cells[at + 1];
      if (map.WaterKindCodes.get(cell) !== 0 || edgeLeadingTo(map.mesh, cell, next) < 0) continue;
      const height = map.DrainageElevations.get(cell),
        lower = map.DrainageElevations.get(next);
      if (
        lower < height ||
        (lower === height && map.DrainageRanks.get(next) < map.DrainageRanks.get(cell))
      )
        targets.set(cell, next);
    }
  }
}
