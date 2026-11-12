import {
  canonicalPosition,
  point,
  spatial,
  unwrapCoordinates,
  type DrainageReach,
} from "@atlas/domain";
import { nativePosition } from "../world/atlasWorkspace";
import type { PhysicalField } from "../world/field";
import { workingArray } from "../world/physicalNumerics";
import { reachesOf } from "../water/riverKeeping";
import type { Reach } from "../water/reaches";
import { riverCourseJudgments } from "../world/worldRiverCourses";
import { coordinateKey } from "../world/worldSources";
import { heldFor } from "../poi/poiReads";
import type { GenerationState } from "../process";
import { isWorldGeography, mapScale } from "../worldSignificance";
import { joinReaches } from "./riverJoin";
import { continuingRivers, followWater, isRefinedMap } from "./riverLineage";

/**
 * What a river is on this map, read by the river's area entry. The channel field holds all the
 * water that runs; a river is a channel on a course significant at this map's scale, inside its
 * frame, or a parent's river continuing here. River publication draws exactly these, one record
 * to a river, and places that stand on a river read exactly these.
 */

/** The stored record of one kept reach: where it ends, what it carries, and its course. */
function reachRecord(
  state: GenerationState,
  kept: Reach,
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
    discharges: members.map((j) => map.FlowAccumulation.get(j)),
    catchmentAreas: members.map((j) => map.CatchmentArea.get(j)),
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
    wanted = [...reachesOf(map)].filter(
      (reach) => !reach.dry && map.mesh.membership(reach.cells[0]) === 1
    ),
    place = new Map(wanted.map((reach, index) => [reach.id, index]));
  return wanted.map((kept) => {
    const next = map.FlowTargets.get(kept.cells[kept.cells.length - 1]),
      members = next >= 0 ? [...kept.cells, next] : [...kept.cells],
      downstream = kept.downstream === null ? null : (place.get(kept.downstream) ?? null);
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
const reachInFrame = (state: GenerationState, start: number) =>
  isWorldGeography(state) ||
  spatial.covers(
    state.domain.scope.footprint,
    point(canonicalPosition(state.domain.world.reference, nativePosition(state.physical!, start)))
  );

/**
 * A course's identity: the end it reaches and the cell it reaches it from. A river's head moves
 * when people take its water, and its end does not, so the identity outlasts what they do to it.
 */
export function riverIdOf(course: readonly ReachMembers[]) {
  const last = course[course.length - 1];
  // The reach a river ends in keeps which river it is, whatever happens to its course.
  if (last.kept.river) return last.kept.river;
  const line = last.reach.coordinates,
    end = line[line.length - 1],
    from = line[Math.max(0, line.length - 2)];
  return `river:${coordinateKey(end[0], end[1])}:${coordinateKey(from[0], from[1])}`;
}
/**
 * A river the map has drawn stays a river: the reach it ends in is told which river it is,
 * and keeps that through changes of course, dry spells and the passes to come.
 */
export function establishRivers(state: GenerationState, records: readonly ReachMembers[]) {
  for (const course of mappedCourses(state, records)) {
    const members = course.map((index) => records[index]);
    members[members.length - 1].kept.river = riverIdOf(members);
  }
}
/** The courses this map draws, as lists of reaches: those significant, and those already rivers. */
export function mappedCourses(state: GenerationState, records: readonly ReachMembers[]) {
  return riverCourseJudgments(
    records.map(({ reach }) => reach),
    mapScale(state)
  )
    .filter(({ publish, course }) => publish || records[course[course.length - 1]].kept.river)
    .map(({ course }) => course);
}

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
  kept: Reach;
  reach: DrainageReach;
}
function riverOfCourse(state: GenerationState, reaches: readonly ReachMembers[]): River {
  const work = state.physical!;
  return {
    id: riverIdOf(reaches),
    cells: reaches
      .filter(({ start }) => reachInFrame(state, start))
      .flatMap(({ members }, n) => members.slice(n ? 1 : 0))
      .filter((cell) => work.map.WaterKindCodes.get(cell) === 0),
  };
}
/** The parents' rivers, each continuing under its own identity; the rest of this map's rivers yield to them. */
function continuedRivers(state: GenerationState, claimed: Set<number>): River[] {
  if (!isRefinedMap(state)) return [];
  const map = state.physical.map;
  return continuingRivers(state)
    .map(({ id, head }) => ({ id, cells: followWater(map, head, claimed) }))
    .filter((river) => river.cells.length > 0);
}
/**
 * The rivers of this map, greatest claim first. Publication draws these; a place on a river is
 * placed on one of these. A parent's river is one here because it is one there.
 */
export const riversOf = (state: GenerationState): readonly River[] =>
  heldFor(state, "rivers:mapped", () => {
    // A building interior has no water of its own to read.
    if (!state.physical) return [];
    const claimed = new Set<number>(),
      continued = continuedRivers(state, claimed),
      records = keptReaches(state),
      own = mappedCourses(state, records)
        .map((course) =>
          riverOfCourse(
            state,
            course.map((index) => records[index])
          )
        )
        .map((river) => ({
          ...river,
          cells: river.cells.filter((cell) => !claimed.has(cell)),
        }))
        .filter((river) => river.cells.length > 0)
        .sort((a, b) => b.cells.length - a.cells.length);
    return [...continued, ...own];
  });
/** Every cell of this map's rivers. */
export const mappedRiverCells = (state: GenerationState): ReadonlySet<number> =>
  heldFor(state, "rivers:cells", () => new Set(riversOf(state).flatMap((river) => river.cells)));

/** Which river a cell is on and how far along it. A cell two rivers share is the first's. */
const riverPositions = (state: GenerationState) =>
  heldFor(state, "rivers:positions", () => {
    const positions = new Map<number, { riverId: string; along: number }>();
    for (const { id, cells } of riversOf(state))
      cells.forEach((cell, k) => {
        if (!positions.has(cell))
          positions.set(cell, { riverId: id, along: k / Math.max(1, cells.length - 1) });
      });
    return positions;
  });
export const riverPositionAt = (state: GenerationState, cell: number) =>
  riverPositions(state).get(cell);

/**
 * The rivers this map draws, each joined from its reaches in the frame. A World and a finer map
 * are drawn the same way: a World holds every reach of a course, a finer map those inside its
 * frame, and a parent's river keeps the reaches its water runs through.
 */
export function drawnRivers(state: GenerationState, records: readonly ReachMembers[]) {
  const course = records.map((): string | null => null);
  for (const members of mappedCourses(state, records)) {
    const id = riverIdOf(members.map((index) => records[index]));
    for (const index of members) course[index] = id;
  }
  return joinReaches(
    records.map(({ start, members, reach }, index) => ({
      downstream: reach.downstream,
      inFrame: reachInFrame(state, start),
      course: course[index],
      held: members.slice(0, -1).flatMap((cell) => riverPositionAt(state, cell)?.riverId ?? []),
    })),
    new Set(isRefinedMap(state) ? continuingRivers(state).map(({ id }) => id) : [])
  );
}
