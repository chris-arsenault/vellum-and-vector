import { point, spatial, unwrapCoordinates, type Band, type DrainageReach } from "@atlas/domain";
import { heldFor } from "../poi/poiReads";
import type { GenerationState } from "../process";
import { isWorldGeography, mapScale } from "../worldSignificance";
import { nativePosition } from "./atlasWorkspace";
import type { PhysicalField } from "./field";
import { releaseWorking, workingArray } from "./physicalNumerics";
import { coordinateKey } from "./worldSources";
import { worldRiverCourses } from "./worldRiverCourses";

/**
 * The one definition of a river on this map. The channel field holds all the water that runs;
 * a river is a channel on a course significant at this map's scale, inside its frame. River
 * publication draws exactly these, and places that stand on a river read exactly these.
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

/** The courses this map draws, as lists of reaches. */
export const mappedCourses = (state: GenerationState, reaches: DrainageReach[]) =>
  worldRiverCourses(reaches, mapScale(state));

/** A river of this map: a thing that exists before and whether or not it is ever published. */
export interface River {
  readonly id: string;
  /** Its land cells inside the frame, from its head to its last before the water it runs into. */
  readonly cells: readonly number[];
}
type ReachMembers = { start: number; members: number[] };
function riverOfCourse(state: GenerationState, reaches: readonly ReachMembers[]): River {
  const work = state.physical!,
    all = reaches.flatMap(({ members }, n) => members.slice(n ? 1 : 0)),
    head = nativePosition(work, all[0]),
    end = nativePosition(work, all[all.length - 1]);
  return {
    id: `river:${coordinateKey(head.x, head.y)}:${coordinateKey(end.x, end.y)}`,
    cells: reaches
      .filter(({ start }) => reachInFrame(state, start))
      .flatMap(({ members }, n) => members.slice(n ? 1 : 0))
      .filter((cell) => work.map.WaterKindCodes.get(cell) === 0),
  };
}
/** The rivers of this map. Publication draws these; a place on a river is placed on one of these. */
export const riversOf = (state: GenerationState): readonly River[] =>
  heldFor(state, "rivers:mapped", () => {
    const map = state.physical!.map,
      { incoming, basinDischarge } = riverInputs(map);
    try {
      const records = [...drainageReaches(state, incoming)];
      return mappedCourses(
        state,
        records.map(({ reach }) => reach)
      )
        .map((course) =>
          riverOfCourse(
            state,
            course.map((index) => records[index])
          )
        )
        .filter((river) => river.cells.length > 0);
    } finally {
      releaseWorking(map, incoming, basinDischarge);
    }
  });
/** Every cell of this map's rivers. */
export const mappedRiverCells = (state: GenerationState): ReadonlySet<number> =>
  heldFor(state, "rivers:cells", () => new Set(riversOf(state).flatMap((river) => river.cells)));
