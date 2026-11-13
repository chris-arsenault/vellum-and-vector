import { unwrapCoordinates, type DrainageReach } from "@atlas/domain";
import { nativePosition } from "../world/atlasWorkspace";
import type { PhysicalField } from "../world/field";
import { workingArray } from "../world/physicalNumerics";
import {
  onRiver,
  reachById,
  reachesOf,
  riverSample,
  riverSuccessor,
  waterAt,
} from "../water/riverKeeping";
import type { ReachView } from "../water/reaches";
import { heldFor } from "../poi/poiReads";
import type { GenerationState } from "../process";
import { isWorldGeography } from "../worldSignificance";
import { joinReaches } from "./riverJoin";

/**
 * What a river is on this map, read by the river's area entry. The channel field holds all the
 * water that runs; a river is a channel on a course significant at this map's scale, inside its
 * frame, or a parent's river continuing here. River publication draws exactly these, one record
 * to a river, and places that stand on a river read exactly these.
 */

/** The stored record of one kept reach: where it ends, what it carries, and its course. */
function reachRecord(
  state: GenerationState,
  kept: ReachView,
  members: number[],
  downstream: number | null
): DrainageReach {
  const work = state.physical!,
    map = work.map,
    start = members[0],
    mouth = members.at(-1)!;
  return {
    downstream,
    waterBody: map.WaterKindCodes.get(mouth) !== 0 ? map.WaterBodyIds.get(mouth) : null,
    order: kept.order,
    basin: map.DrainageBasinIds.get(start),
    coordinates: unwrapCoordinates(
      members.map((j) => {
        const p = nativePosition(work, j);
        return [Math.round(p.x), Math.round(p.y)] as [number, number];
      }),
      map.mesh.periodic?.width
    ) as [number, number][],
    discharges: members.map((j) => waterAt(map, j)),
    catchmentAreas: members.map((j) => riverSample(map, j, "catchment")),
    featureIds: [],
  };
}
/**
 * The map's running reaches, as the water owner keeps them: each with the cell it runs into
 * and its stored record, linked downstream. Nothing is worked out here; a river exists before
 * and whether or not it is drawn.
 */
export function keptReaches(state: GenerationState): ReachMembers[] {
  const map = state.physical!.map,
    wanted = [...reachesOf(map)].filter((reach) => !reach.dry),
    place = new Map(wanted.map((reach, index) => [reach.id, index]));
  return wanted.map((kept) => {
    const next = riverSuccessor(map, kept.cells[kept.cells.length - 1], kept),
      members = next >= 0 ? [...kept.cells, next] : [...kept.cells],
      downstream =
        kept.downstream !== null && next === reachById(map, kept.downstream)?.cells[0]
          ? (place.get(kept.downstream) ?? null)
          : null;
    return {
      start: kept.cells[0],
      members,
      kept,
      reach: reachRecord(state, kept, members, downstream),
    };
  });
}
/** The greatest flow in each drainage basin, by basin id. */
export function basinDischarges(map: PhysicalField) {
  // Basin ids are numbered from one per outlet, so the largest is at most the cell count.
  const basinDischarge = workingArray(map, "float64", "rivers:basin-discharge", map.mesh.count + 1);
  for (let i = 0; i < map.mesh.count; i++) {
    const basin = map.DrainageBasinIds.get(i);
    basinDischarge.set(basin, Math.max(basinDischarge.get(basin), map.FlowAccumulation.get(i)));
  }
  return basinDischarge;
}
/** Whether a finer map draws a reach: a World draws whole courses, wherever they start. */
const reachInFrame = (state: GenerationState, members: readonly number[]) =>
  isWorldGeography(state) ||
  members.some((cell) => state.physical!.map.mesh.membership(cell) === 1);

/** A river of this map: a thing that exists before and whether or not it is ever published. */
export interface River {
  readonly id: string;
  /** Its land cells inside the frame, from its head to its last before the water it runs into. */
  readonly cells: readonly number[];
}
/** A kept reach as publishing reads it: its cells with the cell it runs into, and its record. */
export interface ReachMembers {
  start: number;
  members: number[];
  kept: ReachView;
  reach: DrainageReach;
}
/**
 * The rivers of this map, greatest claim first. Publication draws these; a place on a river is
 * placed on one of these. A parent's river is one here because it is one there.
 */
export const riversOf = (state: GenerationState): readonly River[] =>
  heldFor(state, "rivers:mapped", () => {
    // A building interior has no water of its own to read.
    if (!state.physical) return [];
    const records = keptReaches(state),
      map = state.physical.map,
      own = drawnRivers(state, records)
        .map(({ riverId, parts }): River => ({
          id: riverId,
          cells: parts
            .flatMap((part) => part.flatMap((index, n) => records[index].members.slice(n ? 1 : 0)))
            .filter((cell) => map.mesh.membership(cell) === 1 && onRiver(map, cell)),
        }))
        .filter((river) => river.cells.length > 0)
        .sort((a, b) => b.cells.length - a.cells.length);
    return own;
  });
/** Every cell of this map's rivers. */
export const mappedRiverCells = (state: GenerationState): ReadonlySet<number> =>
  heldFor(state, "rivers:cells", () => new Set(riversOf(state).flatMap((river) => river.cells)));

/** Which river owns a hosted cell. A cell two rivers share is the first's. */
const riverIdentities = (state: GenerationState) =>
  heldFor(state, "rivers:identities", () => {
    const identities = new Map<number, string>();
    for (const { id, cells } of riversOf(state))
      cells.forEach((cell) => {
        if (!identities.has(cell)) identities.set(cell, id);
      });
    return identities;
  });
export const riverIdAt = (state: GenerationState, cell: number) => riverIdentities(state).get(cell);

/**
 * The rivers this map draws, each joined from its reaches in the frame. A World and a finer map
 * are drawn the same way: a World holds every reach of a course, a finer map those inside its
 * frame, and a parent's river keeps the reaches its water runs through.
 */
export function drawnRivers(state: GenerationState, records: readonly ReachMembers[]) {
  return joinReaches(
    records.map(({ members, reach, kept }) => ({
      downstream: reach.downstream,
      inFrame: reachInFrame(state, members),
      course: kept.drawn ? (kept.river ?? null) : null,
    }))
  );
}
