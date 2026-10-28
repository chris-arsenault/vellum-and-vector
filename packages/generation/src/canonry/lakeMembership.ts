import { groupByLabel } from "@atlas/domain";
import type { PhysicalField } from "./field";

/** Water-body identities own grouped membership, including off-content support. Body ids
 * are small positive integers, so one counting pass over the lake cells groups them. */
export function lakeMembership(map: PhysicalField) {
  const labels = new Int32Array(map.mesh.count).fill(-1);
  let labelCount = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes[i] !== 2) continue;
    labels[i] = map.WaterBodyIds[i];
    labelCount = Math.max(labelCount, labels[i] + 1);
  }
  const groups = groupByLabel(labels, labelCount);
  return {
    /** Body ids with at least one cell, ascending. */
    *bodies() {
      for (let id = 0; id < labelCount; id++)
        if (groups.offsets[id + 1] > groups.offsets[id]) yield id;
    },
    /** The body's cells in ascending index order. */
    members(id: number) {
      return groups.members_of(id);
    },
  };
}
