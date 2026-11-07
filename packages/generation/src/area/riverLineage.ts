import type { AtlasFeature } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import type { GenerationState } from "../process";
import { courseLines, type CapturedCourse } from "../regional/courses";
import { cellAt, isContent, regionalSpan } from "../regional/lattice";
import type { RegionalState } from "../regional/state";

/**
 * A parent map's river on its child. The child's river is the water that runs from where the
 * parent's course enters this map: nothing is matched afterwards, so wherever the finer ground
 * bends it, it is still that river, under that river's identity.
 */
export interface ContinuingRiver {
  readonly id: string;
  readonly course: CapturedCourse;
  /** The land cell its course first touches on this map. */
  readonly head: number;
  /** The share of the parent's river, head to end, this map holds. */
  readonly from: number;
  readonly to: number;
}
/** A river's identity on a record that draws it. */
export const riverIdOfRecord = (feature: AtlasFeature) =>
  String(feature.attributes.riverId ?? feature.id);

/** Whether a record's line runs downstream: its discharges grow along it. */
function runsDownstream(feature: AtlasFeature) {
  const flow = feature.attributes.discharges as number[] | undefined;
  return !flow || flow.length < 2 || flow[0] <= flow[flow.length - 1];
}
interface Sample {
  cell: number;
  /** Share of the line's length, head to end. */
  along: number;
}
/** The line's cells on this map, head to end, with how far along the line each lies. */
function samplesOf(state: RegionalState, line: readonly number[][]) {
  const map = state.physical.map,
    step = regionalSpan(state) / 2,
    lengths = line.slice(1).map((p, k) => Math.hypot(p[0] - line[k][0], p[1] - line[k][1])),
    total = lengths.reduce((sum, length) => sum + length, 0) || 1,
    samples: Sample[] = [];
  let run = 0;
  lengths.forEach((length, k) => {
    const [ax, ay] = line[k],
      [bx, by] = line[k + 1],
      steps = Math.max(1, Math.ceil(length / step));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps,
        cell = cellAt(map.mesh, ax + (bx - ax) * t, ay + (by - ay) * t);
      if (cell >= 0 && isContent(map.mesh, cell))
        samples.push({ cell, along: (run + t * length) / total });
    }
    run += length;
  });
  return samples;
}
function continuing(state: RegionalState, course: CapturedCourse): ContinuingRiver | null {
  const parts = courseLines(course.carried?.geometry ?? course.feature.geometry),
    line = parts.flat(),
    downstream = line.length ? runsDownstream(course.feature) : true,
    samples = samplesOf(state, downstream ? line : [...line].reverse()),
    // The finer coast can lie across the line's first cells; the share still counts them.
    head = samples.find(({ cell }) => state.physical.map.WaterKindCodes.get(cell) !== 1);
  if (!head) return null;
  return {
    id: riverIdOfRecord(course.feature),
    course,
    head: head.cell,
    from: samples[0].along,
    to: samples[samples.length - 1].along,
  };
}
/** Where each parent's river enters is settled once for a run: the greatest river first. */
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
/** The land cells water runs through from a head until the sea, or a river already claimed. */
export function followWater(map: PhysicalField, head: number, claimed: Set<number>) {
  const cells: number[] = [];
  for (let i = head; i >= 0 && !claimed.has(i); i = map.FlowTargets.get(i)) {
    const water = map.WaterKindCodes.get(i);
    if (water === 1) break;
    claimed.add(i);
    if (water === 0) cells.push(i);
  }
  return cells;
}
/** A parent's river is a channel the whole way, however little water its head has here. */
export function holdContinuingChannels(state: RegionalState) {
  const map = state.physical.map,
    claimed = new Set<number>();
  for (const { head } of continuingRivers(state))
    for (const cell of followWater(map, head, claimed))
      if (map.RiverOrders.get(cell) <= 0) map.RiverOrders.set(cell, 1);
}
export const isRefinedMap = (state: GenerationState): state is RegionalState => "regional" in state;
