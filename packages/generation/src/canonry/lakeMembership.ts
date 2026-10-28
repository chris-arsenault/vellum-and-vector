import type { PhysicalField } from "./field";

/** Water-body identities own grouped membership, including off-content support. Body ids
 * are small positive integers, so two passes over the lake cells group them: a count per
 * body, then the cells in ascending index order. Nothing here is sized by the world. */
export function lakeMembership(map: PhysicalField) {
  const { WaterKindCodes: kinds, WaterBodyIds: bodies } = map;
  let labelCount = 0,
    lakeCells = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    if (kinds.get(i) !== 2) continue;
    labelCount = Math.max(labelCount, bodies.get(i) + 1);
    lakeCells++;
  }
  const offsets = new Int32Array(labelCount + 1);
  for (let i = 0; i < map.mesh.count; i++) if (kinds.get(i) === 2) offsets[bodies.get(i) + 1]++;
  for (let body = 0; body < labelCount; body++) offsets[body + 1] += offsets[body];
  const members = new Int32Array(lakeCells),
    cursor = offsets.slice(0, labelCount);
  for (let i = 0; i < map.mesh.count; i++)
    if (kinds.get(i) === 2) members[cursor[bodies.get(i)]++] = i;
  return {
    /** Body ids with at least one cell, ascending. */
    *bodies() {
      for (let id = 0; id < labelCount; id++) if (offsets[id + 1] > offsets[id]) yield id;
    },
    /** The body's cells in ascending index order. */
    members(id: number) {
      return members.subarray(offsets[id], offsets[id + 1]);
    },
  };
}
