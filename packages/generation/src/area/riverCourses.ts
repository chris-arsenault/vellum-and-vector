import { point, spatial, unwrapCoordinates, type Band, type DrainageReach } from "@atlas/domain";
import { nativePosition } from "../world/atlasWorkspace";
import type { PhysicalField } from "../world/field";
import { releaseWorking, workingArray } from "../world/physicalNumerics";
import { riverCourseJudgments } from "../world/worldRiverCourses";
import { coordinateKey } from "../world/worldSources";
import { heldFor } from "../poi/poiReads";
import type { GenerationState } from "../process";
import { isWorldGeography, mapScale } from "../worldSignificance";
import { continuingRivers, followWater, isRefinedMap } from "./riverLineage";

/**
 * What a river is on this map, read by the river's area entry. The channel field holds all the
 * water that runs; a river is a channel on a course significant at this map's scale, inside its
 * frame, or a parent's river continuing here. River publication draws exactly these, and places
 * that stand on a river read exactly these.
 */

function riverReach(state: GenerationState, start: number, incoming: Band) {
  const map = state.physical!.map,
    members = [start];
  let i = start;
  while (map.FlowTargets.get(i) >= 0) {
    const j = map.FlowTargets.get(i);
    members.push(j);
    if (map.WaterKindCodes.get(j) !== 0 || map.RiverOrders.get(j) <= 0 || incoming.get(j) !== 1)
      break;
    i = j;
  }
  return members;
}
/** The retained record of one reach: where it ends, what it carries, and its course. */
function reachRecord(
  state: GenerationState,
  start: number,
  members: number[],
  starts: Band
): DrainageReach {
  const work = state.physical!,
    map = work.map,
    mouth = members.at(-1)!;
  return {
    downstream: members.length > 1 && starts.get(mouth) >= 0 ? starts.get(mouth) : null,
    waterBody: map.WaterKindCodes.get(mouth) !== 0 ? map.WaterBodyIds.get(mouth) : null,
    order: map.RiverOrders.get(start),
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
/** Every reach as extraction forms it, linked downstream through the cell it ends on. */
export function* drainageReaches(
  state: GenerationState,
  incoming: Band
): IterableIterator<{ start: number; members: number[]; reach: DrainageReach }> {
  const map = state.physical!.map,
    mesh = map.mesh,
    starts = workingArray(map, "int32", "rivers:reach-starts").fill(-1);
  let count = 0;
  for (let i = 0; i < mesh.count; i++)
    if (mesh.membership(i) === 1 && map.RiverOrders.get(i) > 0 && incoming.get(i) !== 1)
      starts.set(i, count++);
  try {
    for (let i = 0; i < mesh.count; i++) {
      if (starts.get(i) < 0) continue;
      const members = riverReach(state, i, incoming);
      yield { start: i, members, reach: reachRecord(state, i, members, starts) };
    }
  } finally {
    releaseWorking(map, starts);
  }
}
export function riverInputs(map: PhysicalField) {
  // Basin ids are numbered from one per outlet, so the largest is at most the cell count.
  const incoming = workingArray(map, "int32", "rivers:incoming"),
    basinDischarge = workingArray(map, "float64", "rivers:basin-discharge", map.mesh.count + 1);
  for (let i = 0; i < map.mesh.count; i++) {
    const basin = map.DrainageBasinIds.get(i);
    basinDischarge.set(basin, Math.max(basinDischarge.get(basin), map.FlowAccumulation.get(i)));
    const j = map.FlowTargets.get(i);
    if (map.RiverOrders.get(i) > 0 && j >= 0 && map.RiverOrders.get(j) > 0) incoming.add(j, 1);
  }
  return { incoming, basinDischarge };
}
/** Whether a finer map draws a reach: a World draws whole courses, wherever they start. */
export const reachInFrame = (state: GenerationState, start: number) =>
  isWorldGeography(state) ||
  spatial.covers(state.domain.scope.footprint, point(nativePosition(state.physical!, start)));

/**
 * A course's identity: the end it reaches and the cell it reaches it from. A river's head moves
 * when people take its water, and its end does not, so the identity outlasts what they do to it.
 */
export function riverIdOf(reaches: readonly DrainageReach[]) {
  const line = reaches[reaches.length - 1].coordinates,
    end = line[line.length - 1],
    from = line[Math.max(0, line.length - 2)];
  return `river:${coordinateKey(end[0], end[1])}:${coordinateKey(from[0], from[1])}`;
}
/** The rivers this map has published. Once a river, always a river: nothing wears one off the map. */
const established = new WeakMap<GenerationState, Set<string>>();
export function establishRivers(state: GenerationState, reaches: DrainageReach[]) {
  const known = established.get(state) ?? new Set<string>();
  established.set(state, known);
  for (const course of mappedCourses(state, reaches))
    known.add(riverIdOf(course.map((index) => reaches[index])));
}
/** The courses this map draws, as lists of reaches: those significant, and those already rivers. */
export function mappedCourses(state: GenerationState, reaches: DrainageReach[]) {
  const known = established.get(state);
  return riverCourseJudgments(reaches, mapScale(state))
    .filter(
      ({ publish, course }) =>
        publish || known?.has(riverIdOf(course.map((index) => reaches[index])))
    )
    .map(({ course }) => course);
}

/** A river of this map: a thing that exists before and whether or not it is ever published. */
export interface River {
  readonly id: string;
  /** Its land cells inside the frame, from its head to its last before the water it runs into. */
  readonly cells: readonly number[];
}
type ReachMembers = { start: number; members: number[]; reach: DrainageReach };
function riverOfCourse(state: GenerationState, reaches: readonly ReachMembers[]): River {
  const work = state.physical!;
  return {
    id: riverIdOf(reaches.map(({ reach }) => reach)),
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
    // A run without the physical domain has no water of its own to read.
    if (!state.physical) return [];
    const map = state.physical.map,
      { incoming, basinDischarge } = riverInputs(map),
      claimed = new Set<number>();
    try {
      const continued = continuedRivers(state, claimed),
        records = [...drainageReaches(state, incoming)],
        own = mappedCourses(
          state,
          records.map(({ reach }) => reach)
        )
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
    } finally {
      releaseWorking(map, incoming, basinDischarge);
    }
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
