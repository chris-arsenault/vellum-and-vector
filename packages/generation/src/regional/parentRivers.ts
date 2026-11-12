import { courseCells } from "./courses";
import type { RegionalState } from "./state";

/**
 * The parent map's rivers on this map's cells. A finer map takes its parent's rivers as
 * things: the reaches the parent kept and stored, each a line with what it carries. It does
 * not read a picture of river cells. Where the parent stored no rivers, there are none here.
 */
// hpc-exempt: one small table per refinement, read while its context is set up.
const held = new WeakMap<RegionalState, Uint8Array>();

/** The area whose stored rivers this map continues: the nearest above it that has any. */
function riverParent(state: RegionalState) {
  const { areas, drainage } = state.domain.world;
  let parent = areas[state.regional.input.areaId]?.parentId;
  while (parent && !drainage?.[parent]) parent = areas[parent]?.parentId;
  return parent ? drainage![parent] : undefined;
}
/** 1 on each of this map's cells that a parent's river runs through. */
export function parentRiverCells(state: RegionalState) {
  const known = held.get(state);
  if (known) return known;
  const cells = new Uint8Array(state.physical.map.mesh.count),
    lines = (riverParent(state)?.reaches ?? [])
      .map((reach) => reach.coordinates as number[][])
      .filter((line) => line.length >= 2);
  for (const cell of courseCells(state, lines)) cells[cell] = 1;
  held.set(state, cells);
  return cells;
}
/** Whether a parent's river runs through a cell of this map. */
export const onParentRiver = (state: RegionalState, cell: number) =>
  parentRiverCells(state)[cell] === 1;
