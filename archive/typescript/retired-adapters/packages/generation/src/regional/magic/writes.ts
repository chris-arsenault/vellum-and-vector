import type { AtlasFeature } from "@atlas/domain";
import { generationFeatures } from "../../generationFeatures";
import type { MagicField } from "../../world/magicState";
import { cellAt, isContent } from "../lattice";
import type { RegionalState } from "../state";

/** The cell of a position on this frame, or -1 outside it. */
export const frameCell = (state: RegionalState) => (x: number, y: number) => {
  const mesh = state.physical.map.mesh,
    cell = cellAt(mesh, x, y);
  return cell >= 0 && isContent(mesh, cell) ? cell : -1;
};

/** Captured endpoints locate a named place; they do not establish current traversal. */
export function capturedDoor(
  feature: AtlasFeature,
  system: string,
  cellOf: (x: number, y: number) => number
): { a: number; b: number } | null {
  const ends = capturedDoorEnds(feature, system).map(([x, y]) => cellOf(x, y)),
    [a = -1, b = a] = ends;
  if (a < 0 && b < 0) return null;
  return { a: a >= 0 ? a : b, b: b >= 0 ? b : a };
}

/** Read pinned endpoints rather than a previous run's newly realized products. */
function capturedDoorEnds(feature: AtlasFeature, system: string) {
  if (feature.attributes.developedBy === "regional") return [];
  const parent = feature.attributes.capturedRecord as AtlasFeature | undefined,
    record = parent?.attributes ?? feature.attributes;
  return record.system === system && record.rule === "door"
    ? ((record.ends ?? []) as number[][])
    : [];
}

/** Seed candidates once. Shared pairing subsequently removes those whose access has closed. */
export function seedDoors(state: RegionalState, field: MagicField) {
  const cellOf = frameCell(state);
  for (const feature of generationFeatures(state, { areaId: state.regional.input.areaId })) {
    const door = capturedDoor(feature, field.definition.id, cellOf);
    if (door) field.doors.push(door);
  }
}
