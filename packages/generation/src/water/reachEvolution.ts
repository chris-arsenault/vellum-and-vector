import { BitSet, CellList } from "@atlas/domain";
import { flowThroughYear } from "./waterBalance";
import { reachMonths, type Reach, type ReachStore } from "./reaches";

/** Explicit routing and water inputs. River state is changed here, before any cell projection. */
export interface RiverEnvironment {
  count: number;
  order: ArrayLike<number>;
  next(cell: number): number;
  land(cell: number): boolean;
  resolved(cell: number): boolean;
  flow(cell: number, month: number): number;
  bed(cell: number): number;
  catchment(cell: number): number;
  discharge: number;
  epoch: number;
  /** Initial realization may locate heads from captured latent quantities. */
  newHead?(cell: number): boolean;
}

export function addReach(store: ReachStore, cells: readonly number[]): Reach {
  const reach: Reach = {
    id: store.next++,
    cells,
    downstream: null,
    order: 1,
    flow: 0,
    least: 0,
    flood: 0,
    months: 0,
    dry: false,
    drawn: false,
    former: [],
    monthly: new Float64Array(cells.length * 12),
    catchment: new Float64Array(cells.length),
    bed: new Float64Array(cells.length),
    width: new Float64Array(cells.length),
    depth: new Float64Array(cells.length),
    leakage: new Float64Array(cells.length),
  };
  store.reaches.set(reach.id, reach);
  return reach;
}

/** Walk only an unowned course. A confluence is the first cell of the receiving reach. */
function course(from: number, owner: Int32Array, env: RiverEnvironment, own = 0) {
  const cells = new CellList();
  let cell = from;
  while (cell >= 0 && env.land(cell) && env.resolved(cell)) {
    if (owner[cell] && owner[cell] !== own) break;
    cells.push(cell);
    cell = env.next(cell);
  }
  return Array.from(cells.finish());
}

/** A new tributary splits a receiving reach; its named lower end keeps the old identity. */
function splitAt(store: ReachStore, reach: Reach, cell: number, owner: Int32Array) {
  const at = reach.cells.indexOf(cell);
  if (at <= 0) return;
  const upper = addReach(store, reach.cells.slice(0, at));
  upper.downstream = reach.id;
  for (const other of store.reaches.values())
    if (other !== upper && other.downstream === reach.id) other.downstream = upper.id;
  reach.cells = reach.cells.slice(at);
  for (const member of upper.cells) owner[member] = upper.id;
}

/** Update the existing object, retaining dry beds and the course left by a diversion. */
function refresh(reach: Reach, owner: Int32Array, env: RiverEnvironment) {
  const head = reach.cells.find(
    (cell) => env.land(cell) && env.resolved(cell) && hasWater(cell, env)
  );
  const cells = head === undefined ? [] : course(head, owner, env, reach.id);
  if (!cells.length) {
    reach.dry = true;
    reach.driedIn ??= env.epoch;
    return;
  }
  const running = new BitSet(env.count);
  for (const cell of cells) running.add(cell);
  reach.former = reach.former.flatMap((old) =>
    leftCourses(old.cells, running).map((cells) => ({ cells, leftIn: old.leftIn }))
  );
  for (const left of leftCourses(reach.cells, running))
    reach.former.push({ cells: left, leftIn: env.epoch });
  for (const cell of reach.cells) if (owner[cell] === reach.id) owner[cell] = 0;
  reach.cells = cells;
  reach.dry = false;
  delete reach.driedIn;
  for (const cell of reach.cells) owner[cell] = reach.id;
}

/** Retain abandoned edges with their junctions; disjoint diversions remain separate lines. */
function leftCourses(before: readonly number[], running: BitSet) {
  const courses: number[][] = [];
  let part: number[] = [];
  for (let at = 1; at < before.length; at++) {
    if (running.has(before[at - 1]) && running.has(before[at])) {
      if (part.length) courses.push(part);
      part = [];
    } else {
      if (!part.length) part.push(before[at - 1]);
      part.push(before[at]);
    }
  }
  if (part.length) courses.push(part);
  return courses;
}

/** Reach-owned water through the year, and its bed; field layers are downstream projections. */
function updateWater(reach: Reach, env: RiverEnvironment) {
  reach.monthly = new Float64Array(reach.cells.length * 12);
  reach.bed = Float64Array.from(reach.cells, env.bed);
  reach.catchment = Float64Array.from(reach.cells, env.catchment);
  if (reach.width.length !== reach.cells.length) {
    reach.width = new Float64Array(reach.cells.length);
    reach.depth = new Float64Array(reach.cells.length);
  }
  if (!reach.dry)
    reach.cells.forEach((cell, n) => {
      for (let month = 0; month < 12; month++)
        reach.monthly[n * 12 + month] = env.flow(cell, month);
    });
  const end = reach.monthly.subarray(-12),
    water = flowThroughYear(end, env.discharge);
  reach.flow = water.mean;
  reach.least = water.perennial;
  reach.flood = water.flood;
  reach.months = reachMonths(reach, reach.cells.length - 1);
  if (!reach.monthly.some((flow) => flow > 0)) {
    reach.dry = true;
    reach.driedIn ??= env.epoch;
  }
}

/**
 * owner-direction(2026-11-12): rivers are kept things that processes change; cells hold quantities and are never rivers.
 * Existing reaches govern their courses. Discover only newly resolved water, splitting a
 * retained reach where a new tributary joins. No cell river classification is an input.
 */
export function advanceReaches(store: ReachStore, env: RiverEnvironment) {
  const owner = new Int32Array(env.count);
  for (const reach of store.reaches.values())
    if (!reach.dry) for (const cell of reach.cells) owner[cell] = reach.id;
  for (const reach of store.reaches.values()) refresh(reach, owner, env);
  discoverReaches(store, owner, env);
  for (const reach of store.reaches.values()) {
    if (reach.dry) continue;
    const next = env.next(reach.cells[reach.cells.length - 1]);
    reach.downstream = next >= 0 && owner[next] ? owner[next] : null;
    reach.order = 1;
  }
  joinContinuations(store, owner, env);
  for (const reach of store.reaches.values()) updateWater(reach, env);
  assignOrders(store, owner, env);
  store.at = undefined;
}

/** Head extension or a vanished tributary does not introduce an artificial confluence. */
function joinContinuations(store: ReachStore, owner: Int32Array, env: RiverEnvironment) {
  const incoming = incomingReaches(store);
  for (let n = 0; n < env.order.length; n++) {
    const upper = store.reaches.get(owner[env.order[n]]);
    if (!upper || upper.dry || upper.downstream === null) continue;
    const lower = store.reaches.get(upper.downstream);
    if (!lower || incoming[lower.id] !== 1) continue;
    if (differentRivers(upper, lower)) continue;
    mergeInto(store, upper, lower, owner);
    incoming[lower.id] = incoming[upper.id];
  }
}
const differentRivers = (upper: Reach, lower: Reach) =>
  upper.river && lower.river && upper.river !== lower.river;

function incomingReaches(store: ReachStore) {
  const incoming = new Int32Array(store.next);
  for (const reach of store.reaches.values())
    if (!reach.dry && reach.downstream !== null) incoming[reach.downstream]++;
  return incoming;
}

function mergeInto(store: ReachStore, upper: Reach, lower: Reach, owner: Int32Array) {
  lower.cells = [...upper.cells, ...lower.cells];
  lower.former.push(...upper.former);
  lower.river ??= upper.river;
  lower.record ??= upper.record;
  lower.name ??= upper.name;
  for (const cell of upper.cells) owner[cell] = lower.id;
  for (const reach of store.reaches.values())
    if (reach.downstream === upper.id) reach.downstream = lower.id;
  store.reaches.delete(upper.id);
}

function discoverReaches(store: ReachStore, owner: Int32Array, env: RiverEnvironment) {
  for (let n = 0; n < env.order.length; n++) {
    const cell = env.order[n];
    if (!startsReach(cell, owner, env)) continue;
    const cells = course(cell, owner, env);
    if (!cells.length) continue;
    const next = env.next(cells[cells.length - 1]),
      receiving = next >= 0 ? store.reaches.get(owner[next]) : undefined;
    if (receiving) splitAt(store, receiving, next, owner);
    const reach = addReach(store, cells);
    for (const member of cells) owner[member] = reach.id;
  }
}
const startsReach = (cell: number, owner: Int32Array, env: RiverEnvironment) =>
  !owner[cell] &&
  env.land(cell) &&
  env.resolved(cell) &&
  env.newHead?.(cell) !== false &&
  hasWater(cell, env);

function hasWater(cell: number, env: RiverEnvironment) {
  for (let month = 0; month < 12; month++) if (env.flow(cell, month) > 0) return true;
  return false;
}

function assignOrders(store: ReachStore, owner: Int32Array, env: RiverEnvironment) {
  const largest = new Uint16Array(env.count),
    count = new Uint16Array(env.count);
  for (let n = 0; n < env.order.length; n++) {
    const cell = env.order[n],
      reach = store.reaches.get(owner[cell]);
    if (!reach || reach.cells[reach.cells.length - 1] !== cell) continue;
    const head = reach.cells[0];
    reach.order = largest[head] === 0 ? 1 : largest[head] + Number(count[head] > 1);
    const next = reach.downstream === null ? null : store.reaches.get(reach.downstream);
    if (!next) continue;
    const target = next.cells[0];
    if (reach.order > largest[target]) {
      largest[target] = reach.order;
      count[target] = 1;
    } else if (reach.order === largest[target]) count[target]++;
  }
}
