/**
 * Rivers as things. A reach is one stretch of river between confluences. The map keeps its
 * reaches from pass to pass: a reach has an identity that outlasts changes to its course, and
 * what it was before it moved or dried stays on its record. A cell is never a river; a cell
 * is on a reach, or it is not.
 *
 * Each pass the water owner works out where rivers run now (`ReachCut`s) and carries the kept
 * reaches forward onto them. A reach keeps its identity while most of its course is still
 * its course. Ground it has left, with no river on it, becomes one of its former courses. A
 * reach whose water is gone stays, dry, on the course it had.
 */
export interface Reach {
  /** Its identity on this map. Never reused. */
  readonly id: number;
  /** Its land cells from head to end. Its end is the last cell before what it runs into. */
  cells: readonly number[];
  /** The reach it runs into, or null where it ends in standing water, at the edge or dry. */
  downstream: number | null;
  /** Its order among the map's rivers: 1 at a head, rising where equals meet. */
  order: number;
  /** What it carries at its end: the year's mean, its driest month, and its greatest. */
  flow: number;
  least: number;
  flood: number;
  /** The months of the year it carries a river's flow at its end. */
  months: number;
  /** Whether no river runs in it now. A dry reach keeps the course it last had. */
  dry: boolean;
  /** The epoch it dried in, while dry. */
  driedIn?: number;
  /** Courses it has left, oldest first. */
  former: FormerCourse[];
  /** The river it is the end of, once the map has drawn that river. */
  river?: string;
  /** The record the map drew that river as, so a later drawing of it is the same record. */
  record?: string;
}
/** Ground a river ran on and left, and the epoch it left it in. */
export interface FormerCourse {
  cells: readonly number[];
  leftIn: number;
}
/** Where a river runs this pass, before it is known which kept reach it is. */
export type ReachCut = Pick<Reach, "cells" | "order" | "flow" | "least" | "flood" | "months"> & {
  /** The cut it runs into, by its place in the list. */
  downstream: number | null;
};
export interface ReachStore {
  readonly reaches: Map<number, Reach>;
  /** The next identity to give. */
  next: number;
  /** The reach each cell is on, worked out when first asked after the reaches change. */
  at?: Map<number, Reach>;
}
export const emptyReaches = (): ReachStore => ({ reaches: new Map(), next: 1 });
/** Whether the ground still keeps a course no river runs in, given the epoch it was left in. */
export type KeepsCourse = (course: readonly number[], leftIn: number) => boolean;

export type Regime = "perennial" | "seasonal" | "dry";
/** What a reach is through the year. */
export const regimeOf = (reach: Pick<Reach, "months" | "dry">): Regime =>
  reach.dry || reach.months <= 0 ? "dry" : reach.months >= 12 ? "perennial" : "seasonal";

/** How many of a course's cells are in a set. */
function shared(course: readonly number[], cells: ReadonlySet<number>) {
  let count = 0;
  for (const cell of course) if (cells.has(cell)) count++;
  return count;
}
/**
 * Whether a course is still the same course: the ground the two share is at least half of
 * the longer of them. A river that shifts part of its course is the same river. One that
 * takes a different valley is a new one. A short new stretch on a long old course is not
 * that course come back, and half of a course cut in two is at most its other half's equal.
 */
export const sameCourse = (overlap: number, before: number, now: number) =>
  overlap > 0 && 2 * overlap >= Math.max(before, now);

interface Pairing {
  cut: number;
  kept: number;
  overlap: number;
}
/** Each cut with each kept reach whose course it still is, the most shared ground first. */
function pairings(store: ReachStore, cuts: readonly ReachCut[]) {
  const holders = new Map<number, number[]>();
  for (const reach of store.reaches.values())
    for (const cell of reach.cells) {
      const held = holders.get(cell);
      if (held) held.push(reach.id);
      else holders.set(cell, [reach.id]);
    }
  const pairs: Pairing[] = [];
  cuts.forEach((cut, index) => {
    const candidates = new Set(cut.cells.flatMap((cell) => holders.get(cell) ?? []));
    for (const kept of candidates) {
      const before = store.reaches.get(kept)!,
        overlap = shared(cut.cells, new Set(before.cells));
      if (sameCourse(overlap, before.cells.length, cut.cells.length))
        pairs.push({ cut: index, kept, overlap });
    }
  });
  return pairs.sort((a, b) => b.overlap - a.overlap || a.kept - b.kept || a.cut - b.cut);
}
/** The ground of a course that no river runs on now, as runs of cells in their old order. */
export function leftCourses(before: readonly number[], running: ReadonlySet<number>) {
  const runs: number[][] = [];
  let run: number[] = [];
  for (const cell of before) {
    if (!running.has(cell)) run.push(cell);
    else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs;
}
const sameCells = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((cell, n) => cell === b[n]);
/**
 * The former courses a reach goes on keeping: those the ground still keeps, that no river
 * has taken back, each once.
 */
function keptFormer(
  former: readonly FormerCourse[],
  running: ReadonlySet<number>,
  keeps: KeepsCourse
) {
  const kept: FormerCourse[] = [];
  for (const course of former) {
    if (2 * shared(course.cells, running) >= course.cells.length) continue;
    if (!keeps(course.cells, course.leftIn)) continue;
    if (!kept.some((other) => sameCells(other.cells, course.cells))) kept.push(course);
  }
  return kept;
}
/**
 * Carries the kept reaches onto where rivers run now. `epoch` is the epoch this pass is in;
 * `keeps` says whether a course no river runs in still stands on the ground.
 */
export function carryReaches(
  store: ReachStore,
  cuts: readonly ReachCut[],
  epoch: number,
  keeps: KeepsCourse = () => true
) {
  const taken = new Map<number, number>(),
    claimed = new Set<number>(),
    running = new Set(cuts.flatMap((cut) => cut.cells));
  for (const { cut, kept } of pairings(store, cuts)) {
    if (taken.has(cut) || claimed.has(kept)) continue;
    taken.set(cut, kept);
    claimed.add(kept);
  }
  const ids = cuts.map((_, index) => taken.get(index) ?? store.next++);
  cuts.forEach((cut, index) => {
    const before = store.reaches.get(ids[index]),
      left = before && !before.dry ? leftCourses(before.cells, running) : [],
      former = [...(before?.former ?? []), ...left.map((cells) => ({ cells, leftIn: epoch }))];
    store.reaches.set(ids[index], {
      id: ids[index],
      cells: cut.cells,
      downstream: cut.downstream === null ? null : ids[cut.downstream],
      order: cut.order,
      flow: cut.flow,
      least: cut.least,
      flood: cut.flood,
      months: cut.months,
      dry: false,
      former: keptFormer(former, running, keeps),
      river: before?.river,
      record: before?.record,
    });
  });
  settleTheRest(store, new Set(ids), running, epoch, keeps);
  store.at = undefined;
}
/** The running reach that now holds the most of a course's ground, if any does. */
function heir(store: ReachStore, course: readonly number[], running: ReadonlySet<number>) {
  const at = reachOfCells(store, running);
  let best: Reach | undefined,
    most = 0;
  const counts = new Map<number, number>();
  for (const cell of course) {
    const reach = at.get(cell);
    if (!reach || reach.dry) continue;
    const count = (counts.get(reach.id) ?? 0) + 1;
    counts.set(reach.id, count);
    // The reach holding the course's lower end wins a tie: a river is known by its end.
    if (count >= most) [best, most] = [reach, count];
  }
  return best;
}
/**
 * The kept reaches that are not themselves carried on. One whose ground rivers still run on
 * has been taken into another reach, where two reaches became one: it passes on what it was
 * known as and is gone. One with no river on it stays, dry, while the ground keeps its course.
 */
function settleTheRest(
  store: ReachStore,
  carried: ReadonlySet<number>,
  running: ReadonlySet<number>,
  epoch: number,
  keeps: KeepsCourse
) {
  for (const reach of [...store.reaches.values()]) {
    if (carried.has(reach.id)) continue;
    if (2 * shared(reach.cells, running) >= reach.cells.length) absorb(store, reach, running);
    else dry(store, reach, epoch, keeps);
  }
  // What a reach ran into may be gone; a course then ends where it ends.
  for (const reach of store.reaches.values())
    if (reach.downstream !== null && !store.reaches.has(reach.downstream)) reach.downstream = null;
}
function absorb(store: ReachStore, reach: Reach, running: ReadonlySet<number>) {
  const into = heir(store, reach.cells, running);
  if (into) {
    into.river ??= reach.river;
    into.record ??= reach.record;
    into.former.push(...reach.former);
  }
  store.reaches.delete(reach.id);
}
function dry(store: ReachStore, reach: Reach, epoch: number, keeps: KeepsCourse) {
  const driedIn = reach.driedIn ?? epoch;
  if (!keeps(reach.cells, driedIn)) {
    store.reaches.delete(reach.id);
    return;
  }
  reach.dry = true;
  reach.driedIn = driedIn;
  reach.months = reach.flow = reach.least = reach.flood = 0;
}
/**
 * The reach each cell is on: a running reach before a dry one, the greater order first. With
 * `only`, just the cells in that set.
 */
export function reachOfCells(store: ReachStore, only?: ReadonlySet<number>) {
  const index = new Map<number, Reach>(),
    better = (a: Reach, b: Reach) =>
      Number(b.dry) - Number(a.dry) || a.order - b.order || b.id - a.id;
  for (const reach of store.reaches.values())
    for (const cell of reach.cells) {
      if (only && !only.has(cell)) continue;
      const held = index.get(cell);
      if (!held || better(reach, held) > 0) index.set(cell, reach);
    }
  return index;
}
