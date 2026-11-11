import { population, type Position, type SocietyConnection } from "@atlas/domain";
import type { GenerationState } from "./process";
import { nativeIndexAtSurface } from "./world/atlasWorkspace";
import { withRouteFinder, type RouteFinder } from "./mapRouting";
import { meshDeltaX } from "./world/mesh";
import type { PhysicalField } from "./world/field";
import { defineCommand } from "./processOperation";
import type { SocietyInput } from "./societyOperation";

/**
 * What people leave on the ground, written to the mesh at the end of every society cycle as
 * amounts the crust carries on: person-years at each inhabited seat (tenure), traveller-years
 * on every cell a way crosses (walked routes), and the dead, once per event and once per
 * cycle of net population fall at a community (mass death). Society-sourced magic is made of
 * these; nothing here is a magic field of its own.
 */
export const recordSocietyOnMesh = defineCommand(
  "human.ground-record",
  "elapsed",
  ({ state, years }: SocietyInput) => record(state, years),
  []
);
function record(state: GenerationState, years: number) {
  if (!state.physical || !state.society || years <= 0) return;
  decayMaintainedGround(state.physical.map, years);
  const deaths = recordSeats(state, years) + recordEvents(state);
  walkRoutes(state, years);
  keepLines(state, years);
  // A system made of the dead is re-evaluated when there are new dead to make it from.
  if (deaths > 0)
    for (const system of state.domain.world.magicSystems ?? [])
      if (system.enabled && system.origins.some((origin) => origin.source === "death"))
        (state.society.magicTouched ??= new Set()).add(system.id);
}
function cellAt(state: GenerationState, p: Pick<Position, "x" | "y">) {
  return nativeIndexAtSurface(state, p.x, p.y);
}
/** Person-years at every inhabited seat, and the cycle's die-offs where they happened. */
function recordSeats(state: GenerationState, years: number) {
  const map = state.physical!.map,
    society = state.society!;
  let deaths = 0;
  for (const c of society.region.communities) {
    const cell = cellAt(state, c.position);
    if (cell < 0) continue;
    if (c.status === "inhabited") map.Tenure.add(cell, population(c) * years);
    const fell = society.dieOff?.get(c.id) ?? 0;
    if (fell <= 0) continue;
    map.MassDeath.add(cell, fell);
    deaths += fell;
  }
  society.dieOff?.clear();
  return deaths;
}
/** Each event's casualties, once, where the event struck. */
function recordEvents(state: GenerationState) {
  const map = state.physical!.map,
    society = state.society!,
    recorded = (society.deathsRecorded ??= new Set());
  let deaths = 0;
  for (const event of society.region.events) {
    if (recorded.has(event.id) || event.casualties <= 0) continue;
    recorded.add(event.id);
    const cell = cellAt(state, event.position);
    if (cell < 0) continue;
    map.MassDeath.add(cell, event.casualties);
    deaths += event.casualties;
  }
  return deaths;
}
/** Every cell under a way takes the way's yearly travellers for the years of the cycle. */
function walkRoutes(state: GenerationState, years: number) {
  const map = state.physical!.map,
    region = state.society!.region,
    positions = new Map(region.communities.map((c) => [c.id, c.position])),
    travelled = state.society!.travelled ?? new Float64Array(region.connections.length);
  const record = (route: RouteFinder) => {
    for (const [index, link] of region.connections.entries()) {
      const traffic = travelled[index],
        a = positions.get(link.from),
        b = positions.get(link.to);
      if (!a || !b || !walkableTraffic(traffic, link.kind)) continue;
      for (const cell of walkedCells(state, link, a, b, route))
        map.WalkedRoute.add(cell, traffic * years);
    }
  };
  if (
    region.connections.some(
      (link, i) => walkableTraffic(travelled[i], link.kind) && !walks.has(link)
    )
  )
    withRouteFinder(state.surface, record);
  else record(() => []);
}
// hpc-exempt: one typed route per connection; rebuilding the connection graph invalidates its path.
const walks = new WeakMap<SocietyConnection, Int32Array>();
function walkedCells(
  state: GenerationState,
  link: SocietyConnection,
  a: Position,
  b: Position,
  route: RouteFinder
) {
  let cells = walks.get(link);
  if (!cells) {
    const path = route(a, b, "road"),
      found = new Set<number>();
    for (let n = 1; n < path.length; n++)
      for (const cell of cellsAlong(
        state,
        path[n - 1],
        path[n],
        state.physical!.map.mesh.spacing / 2
      ))
        found.add(cell);
    cells = Int32Array.from(found);
    walks.set(link, cells);
  }
  return cells;
}
const walkableTraffic = (traffic: number, kind: string) =>
  traffic > 0 && kind !== "sea" && kind !== "door";
/** Years over which an unkept line is forgotten. */
export const lineMemory = 150;
export const maintenanceRetention = (years: number) => Math.exp(-Math.max(0, years) / lineMemory);
/** Both elapsed-time owners age the same records; source refreshes never age them. */
export function decayMaintainedGround(
  map: Pick<PhysicalField, "WalkedRoute" | "KeptLine">,
  years: number
) {
  const keep = maintenanceRetention(years);
  for (const values of [map.WalkedRoute, map.KeptLine])
    for (let i = 0; i < values.length; i++) values.set(i, values.get(i) * keep);
}
/** The condition above which a work keeps its line. */
export const keptCondition = 0.5;
/** Works with no catalogue entry of their own; a dam, irrigation or harbour declares its line. */
const keptWorkKinds = new Set(["pass", "weir"]);
/**
 * The lines people keep: a frontier, where a way's two ends are held by different polities,
 * is kept at both seats; a work kept in condition keeps the bank or the pass it stands on.
 * Every line forgets over the memory, so one nobody walks fades from the ground.
 */
function keepLines(state: GenerationState, years: number) {
  const map = state.physical!.map;
  const keptAt = (p: Pick<Position, "x" | "y">) => {
    const cell = cellAt(state, p);
    if (cell >= 0) map.KeptLine.add(cell, years);
  };
  for (const seat of frontierSeats(state)) keptAt(seat);
  for (const work of state.society!.region.works)
    if (keptWorkKinds.has(work.kind) && work.condition > keptCondition && !work.demand)
      keptAt(work.position);
}
/** The seats at both ends of every way whose ends different polities control. */
function frontierSeats(state: GenerationState) {
  const region = state.society!.region,
    control = region.politics?.control ?? {},
    seats = new Map(region.communities.map((c) => [c.id, c.position])),
    frontier: Position[] = [];
  for (const link of region.connections) {
    const a = control[link.from],
      b = control[link.to];
    if (!a || !b || a === b) continue;
    for (const id of [link.from, link.to]) {
      const seat = seats.get(id);
      if (seat) frontier.push(seat);
    }
  }
  return frontier;
}
function cellsAlong(
  state: GenerationState,
  a: Pick<Position, "x" | "y">,
  b: Pick<Position, "x" | "y">,
  step: number
) {
  const dx = meshDeltaX(state.physical!.map.mesh, b.x - a.x),
    steps = Math.max(1, Math.ceil(Math.hypot(dx, b.y - a.y) / step)),
    cells = new Set<number>();
  for (let n = 0; n <= steps; n++) {
    const t = n / steps,
      cell = cellAt(state, { x: a.x + dx * t, y: a.y + (b.y - a.y) * t });
    if (cell >= 0) cells.add(cell);
  }
  return cells;
}
