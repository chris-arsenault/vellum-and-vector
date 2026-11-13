import type { AtlasFeature } from "@atlas/domain";
import type { CapturedCourse } from "../regional/courses";
import type { RegionalState } from "../regional/state";

/** One actual captured parent fragment and the river identity it carries. */
export interface ContinuingRiver {
  readonly id: string;
  readonly course: CapturedCourse;
  /** First current land cell of this directed fragment. */
  readonly head: number;
}
/** A river's identity on a record that draws it. */
export const riverIdOfRecord = (feature: AtlasFeature) =>
  String(feature.attributes.riverId ?? feature.id);

function continuing(state: RegionalState, course: CapturedCourse): ContinuingRiver | null {
  const head = course.cells.find((cell) => state.physical.map.WaterKindCodes.get(cell) !== 1);
  return head === undefined ? null : { id: riverIdOfRecord(course.feature), course, head };
}
/** Each distinct current fragment survives; shared ancestry does not supersede its geometry. */
const settled = new WeakMap<RegionalState, readonly ContinuingRiver[]>();
export function continuingRivers(state: RegionalState): readonly ContinuingRiver[] {
  const known = settled.get(state);
  if (known) return known;
  const courses = state.regional.evidence?.courses;
  if (!courses) return [];
  const rivers = courses
    .map((course) => continuing(state, course))
    .filter((river): river is ContinuingRiver => river !== null)
    .sort((a, b) => b.course.discharge - a.course.discharge || (a.id < b.id ? -1 : 1));
  settled.set(state, rivers);
  return rivers;
}
