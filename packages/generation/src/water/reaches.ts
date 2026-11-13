/** A retained course between confluences, changed by the water owner across passes. */
export interface Reach {
  readonly id: number;
  /** Land cells from head to end, before the receiving reach or standing water. */
  cells: readonly number[];
  downstream: number | null;
  order: number;
  /** Mean, least and flood discharge at the end, derived from the monthly profile. */
  flow: number;
  least: number;
  flood: number;
  months: number;
  dry: boolean;
  drawn: boolean;
  driedIn?: number;
  former: FormerCourse[];
  /** Cell-major twelve-month discharge, in cubic metres per second. */
  monthly: Float64Array;
  catchment: Float64Array;
  bed: Float64Array;
  width: Float64Array;
  depth: Float64Array;
  leakage: Float64Array;
  /** Published identity and name survive loss of water. */
  river?: string;
  record?: string;
  name?: string;
}
export interface FormerCourse {
  cells: readonly number[];
  leftIn: number;
}
export interface ReachStore {
  readonly reaches: Map<number, Reach>;
  next: number;
  /** Captured boundary crossings bring their actual monthly water and upstream catchment. */
  entries: { cell: number; monthly: Float64Array; catchment: number }[];
  at?: ReachIndex;
}
export const emptyReaches = (): ReachStore => ({ reaches: new Map(), next: 1, entries: [] });

/** A losing river can have water upstream of a dry end. */
export function reachMonths(reach: Reach, at: number) {
  let months = 0;
  for (let month = 0; month < 12; month++) if (reach.monthly[at * 12 + month] > 0) months++;
  return months;
}
export type Regime = "perennial" | "seasonal" | "dry";
export const regimeOf = (reach: Pick<Reach, "months" | "dry">): Regime =>
  reach.dry || reach.months <= 0 ? "dry" : reach.months >= 12 ? "perennial" : "seasonal";

/** A running course takes precedence over an overlapping dry one, then greater order. */
export function reachOfCells(store: ReachStore) {
  let size = 0;
  for (const reach of store.reaches.values())
    for (const cell of reach.cells) size = Math.max(size, cell + 1);
  const index = new ReachIndex(store, size);
  for (const reach of store.reaches.values())
    for (const [at, cell] of reach.cells.entries()) {
      const held = index.get(cell);
      if (!held || preferred(reach, at, held, index.position(cell))) index.set(cell, reach, at);
    }
  return index;
}

/** A reach's wet head does not make its dry tail the running river at an overlap. */
function preferred(candidate: Reach, at: number, held: Reach, heldAt: number) {
  const dryHere = (reach: Reach, position: number) =>
    reach.dry || reachMonths(reach, position) === 0;
  return (
    (Number(dryHere(held, heldAt)) - Number(dryHere(candidate, at)) ||
      Number(held.dry) - Number(candidate.dry) ||
      candidate.order - held.order ||
      held.id - candidate.id) > 0
  );
}

/** Dense cell lookup is derived from owned reaches, with the profile position alongside. */
export class ReachIndex {
  private readonly ids: Int32Array;
  private readonly along: Int32Array;
  constructor(
    private readonly store: ReachStore,
    count: number
  ) {
    this.ids = new Int32Array(count);
    this.along = new Int32Array(count);
  }
  get(cell: number) {
    return this.store.reaches.get(this.ids[cell]);
  }
  position(cell: number) {
    return this.along[cell];
  }
  set(cell: number, reach: Reach, at: number) {
    this.ids[cell] = reach.id;
    this.along[cell] = at;
  }
}
